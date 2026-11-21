'use strict';
// Diagnóstico de batería y estado general. Solo lectura.
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');
const P = require('./parsers');
const { parsePlist } = require('./plist');

const pct = (a, b) => (a && b ? Math.round((a / b) * 1000) / 10 : null);
const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== '' && !Number.isNaN(x));

/** Interpreta AppleSmartBattery (idevicediagnostics ioregentry). */
function iosBatteryFromIoreg(obj) {
  const r = (obj && (obj.IORegistry || obj)) || {};
  const bd = r.BatteryData || {};
  const design = first(r.DesignCapacity, bd.DesignCapacity);
  const rawMax = first(r.AppleRawMaxCapacity, bd.AppleRawMaxCapacity, r.NominalChargeCapacity, bd.NominalChargeCapacity);
  const t = first(r.Temperature, bd.Temperature);
  return {
    cycleCount: first(r.CycleCount, bd.CycleCount) ?? null,
    designCapacityMah: design ?? null,
    fullChargeCapacityMah: rawMax ?? null,
    healthPercent: first(bd.MaximumCapacityPercent, r.MaximumCapacityPercent, pct(rawMax, design)) ?? null,
    temperatureC: t !== undefined ? Math.round(t) / 100 : null,
    voltageMv: first(r.Voltage, r.AppleRawBatteryVoltage) ?? null,
    currentCapacityPercent: first(r.CurrentCapacity) ?? null,
    isCharging: r.IsCharging ?? null,
    externalConnected: r.ExternalConnected ?? null,
    serial: first(r.Serial, bd.Serial) ?? null,
    source: 'AppleSmartBattery',
  };
}

async function iosBattery(udid) {
  try {
    const { stdout } = await tools.run('idevicediagnostics', ['-u', udid, 'ioregentry', 'AppleSmartBattery'], { timeout: 20000 });
    const b = iosBatteryFromIoreg(parsePlist(stdout));
    if (b.cycleCount !== null || b.designCapacityMah !== null) return b;
  } catch { /* probar el método antiguo */ }
  // iOS antiguos: diagnostics GasGauge
  const { stdout } = await tools.run('idevicediagnostics', ['-u', udid, 'diagnostics', 'GasGauge'], { timeout: 20000 });
  const g = (parsePlist(stdout) || {}).GasGauge || {};
  return {
    cycleCount: g.CycleCount ?? null,
    designCapacityMah: g.DesignCapacity ?? null,
    fullChargeCapacityMah: g.FullChargeCapacity ?? null,
    healthPercent: pct(g.FullChargeCapacity, g.DesignCapacity),
    temperatureC: null, voltageMv: null, currentCapacityPercent: null, isCharging: null, externalConnected: null, serial: null,
    source: 'GasGauge',
  };
}

/** Lee contadores de /sys (si el fabricante los expone a ADB) y los combina con dumpsys battery. */
function androidBatteryFromSys(sysText, dumpsys) {
  const kv = {};
  for (const line of String(sysText).split(/\r?\n/)) {
    const m = /^(\w+)=(-?\d+)$/.exec(line.trim());
    if (m) kv[m[1]] = Number(m[2]);
  }
  const d = P.parseDumpsysBattery(dumpsys || '');
  // Valores en µAh en /sys; algunos fabricantes ya dan mAh.
  const toMah = (v) => (v === undefined ? null : v > 100000 ? Math.round(v / 1000) : v);
  const full = toMah(kv.charge_full);
  const design = toMah(kv.charge_full_design);
  const cycles = kv.cycle_count ?? d.cycleCount ?? null;
  return {
    cycleCount: cycles !== null && cycles >= 0 ? cycles : null,
    designCapacityMah: design,
    fullChargeCapacityMah: full,
    healthPercent: kv.state_of_health ?? pct(full, design),
    temperatureC: d.temperatureC,
    voltageMv: d.voltageMv,
    currentCapacityPercent: d.level,
    isCharging: d.status === 'Cargando',
    healthStatus: d.health,
    technology: d.technology,
    source: full || design || kv.cycle_count !== undefined ? '/sys/class/power_supply' : 'dumpsys battery',
  };
}

const SYS_CMD = 'for f in cycle_count charge_full charge_full_design state_of_health; do for d in /sys/class/power_supply/battery /sys/class/power_supply/bms; do [ -r "$d/$f" ] && { echo "$f=$(cat "$d/$f")"; break; }; done; done; true';

async function androidBattery(serial) {
  const sh = (c) => tools.run('adb', ['-s', serial, 'shell', c]).then((r) => r.stdout).catch(() => '');
  const [sys, dump] = await Promise.all([sh(SYS_CMD), sh('dumpsys battery')]);
  return androidBatteryFromSys(sys, dump);
}

/** Valoración sencilla para el informe. */
function batteryVerdict(b) {
  if (!b || b.healthPercent === null || b.healthPercent === undefined) return { level: 'unknown', text: 'El teléfono no informa de la capacidad máxima.' };
  if (b.healthPercent >= 85) return { level: 'ok', text: 'Batería en buen estado.' };
  if (b.healthPercent >= 80) return { level: 'warn', text: 'Batería algo desgastada; vigilar.' };
  return { level: 'bad', text: 'Batería degradada: se recomienda sustituirla (por debajo del 80 %).' };
}

// ── Informe ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function reportHtml(info, battery, { taller = 'MVR Servicio Móvil', fecha = new Date() } = {}) {
  const ios = info.platform === 'ios';
  const rows = ios ? [
    ['Dispositivo', info.marketName], ['Nombre', info.name], ['Modelo', info.model], ['Nº de modelo', info.modelNumber], ['iOS', `${info.iosVersion || '—'} (${info.buildId || '—'})`],
    ['Nº de serie', info.serialNumber], ['UDID', info.serial], ['Estado de activación', info.activationState],
  ] : [
    ['Dispositivo', info.marketName], ['Fabricante', info.manufacturer], ['Modelo', `${info.model || '—'} (${info.device || '—'})`], ['Android', `${info.androidVersion || '—'} (SDK ${info.sdk || '—'})`],
    ['Parche de seguridad', info.securityPatch], ['Build', info.buildId], ['Nº de serie ADB', info.serial],
    ['Bootloader', info.bootloaderLocked === null ? '—' : (info.bootloaderLocked ? 'Bloqueado' : 'Desbloqueado')], ['Verified boot', info.verifiedBoot],
  ];
  const st = info.storage;
  if (st) rows.push(['Almacenamiento', `${P.formatBytes(st.usedBytes ?? st.totalBytes - st.freeBytes)} usados de ${P.formatBytes(st.totalBytes)}`]);
  const b = battery || {};
  const v = batteryVerdict(b);
  const brow = [
    ['Salud (capacidad máxima)', b.healthPercent != null ? `${b.healthPercent} %` : '—'], ['Ciclos de carga', b.cycleCount],
    ['Capacidad de diseño', b.designCapacityMah ? `${b.designCapacityMah} mAh` : '—'], ['Capacidad actual a plena carga', b.fullChargeCapacityMah ? `${b.fullChargeCapacityMah} mAh` : '—'],
    ['Carga actual', b.currentCapacityPercent != null ? `${b.currentCapacityPercent} %` : '—'], ['Temperatura', b.temperatureC != null ? `${b.temperatureC} °C` : '—'],
    ['Voltaje', b.voltageMv ? `${b.voltageMv} mV` : '—'],
  ];
  const table = (r) => `<table>${r.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}</table>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe ${esc(info.model || info.serial)}</title>
<style>body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 16px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:24px 0 8px;border-bottom:2px solid #111;padding-bottom:4px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}th{width:45%;font-weight:600;color:#444}
.v{padding:10px 12px;border-radius:6px;margin-top:10px;font-weight:600}.ok{background:#dcfce7}.warn{background:#fef9c3}.bad{background:#fee2e2}.unknown{background:#f3f4f6}
.meta{color:#666}.firma{margin-top:48px;display:flex;gap:48px}.firma div{flex:1;border-top:1px solid #999;padding-top:6px;color:#666}
@media print{body{margin:0}}</style></head><body>
<h1>Informe de estado del dispositivo</h1>
<div class="meta">${esc(taller)} · ${esc(fecha.toLocaleString('es-ES'))}</div>
<h2>Dispositivo</h2>${table(rows)}
<h2>Batería</h2>${table(brow)}<div class="v ${v.level}">${esc(v.text)}</div>
<div class="firma"><div>Firma del técnico</div><div>Firma del cliente</div></div>
<p class="meta" style="margin-top:32px;font-size:12px">MVR Servicio Móvil · Desarrollado por Miguel Velasco Rebollo</p>
</body></html>`;
}

function saveReport(dir, info, battery) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `informe-${String(info.model || info.name || 'dispositivo').replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.html`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, reportHtml(info, battery));
  return file;
}

async function restartAdb() {
  await tools.run('adb', ['kill-server'], { timeout: 15000 }).catch(() => {});
  await tools.run('adb', ['start-server'], { timeout: 30000 });
  return true;
}

module.exports = { iosBattery, androidBattery, iosBatteryFromIoreg, androidBatteryFromSys, batteryVerdict, reportHtml, saveReport, restartAdb, SYS_CMD };
