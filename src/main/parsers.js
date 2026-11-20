'use strict';
// Analizadores puros de la salida de adb / libimobiledevice. Sin efectos: fáciles de probar.

/** `adb devices -l` → [{serial, state, model, product, device, transportId}] */
function parseAdbDevices(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) continue;
    const d = { serial, state };
    for (const kv of rest) {
      const i = kv.indexOf(':');
      if (i > 0) d[kv.slice(0, i).replace(/_(\w)/g, (_, c) => c.toUpperCase())] = kv.slice(i + 1);
    }
    if (d.model) d.model = d.model.replace(/_/g, ' ');
    out.push(d);
  }
  return out;
}

/** `fastboot devices` → [{serial, state:'fastboot'}] */
function parseFastbootDevices(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\s+/)).filter((p) => p.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
}

/** `adb shell getprop` → { 'ro.product.model': 'Pixel 7', ... } */
function parseGetprop(text) {
  const props = {};
  const re = /^\[([^\]]+)\]:\s*\[([^\]]*)\]/;
  for (const line of String(text).split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (m) props[m[1]] = m[2];
  }
  return props;
}

const BATTERY_HEALTH = { 1: 'Desconocida', 2: 'Buena', 3: 'Sobrecalentada', 4: 'Agotada', 5: 'Sobrevoltaje', 6: 'Fallo', 7: 'Fría' };
const BATTERY_STATUS = { 1: 'Desconocido', 2: 'Cargando', 3: 'Descargando', 4: 'Sin cargar', 5: 'Llena' };

/** `adb shell dumpsys battery` → {level, health, status, temperatureC, voltageMv, technology, ...} */
function parseDumpsysBattery(text) {
  const kv = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w .]*?):\s*(.*)$/.exec(line);
    if (m) kv[m[1].trim()] = m[2].trim();
  }
  const num = (k) => (kv[k] !== undefined && kv[k] !== '' && !Number.isNaN(Number(kv[k])) ? Number(kv[k]) : null);
  const scale = num('scale') || 100;
  const level = num('level');
  return {
    level: level === null ? null : Math.round((level * 100) / scale),
    health: BATTERY_HEALTH[num('health')] || null,
    status: BATTERY_STATUS[num('status')] || null,
    temperatureC: num('temperature') === null ? null : num('temperature') / 10,
    voltageMv: num('voltage'),
    technology: kv.technology || null,
    acPowered: kv['AC powered'] === 'true',
    usbPowered: kv['USB powered'] === 'true',
    cycleCount: num('cycle count'),
  };
}

/** `adb shell df -k /data` → {totalBytes, usedBytes, freeBytes} (toma la última fila). */
function parseDf(text) {
  const rows = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = rows.length - 1; i >= 0; i--) {
    const p = rows[i].split(/\s+/);
    const nums = p.slice(1, 4).map(Number);
    if (p.length >= 4 && nums.every((n) => Number.isFinite(n))) {
      const [total, used, free] = nums;
      return { totalBytes: total * 1024, usedBytes: used * 1024, freeBytes: free * 1024 };
    }
  }
  return null;
}

/** `ideviceinfo` (formato "Clave: valor") → objeto plano. */
function parseIdeviceinfo(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s/.test(line)) continue; // ignora valores anidados
    const i = line.indexOf(': ');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 2).trim();
  }
  return out;
}

/** `idevice_id -l` → ['00008110-...', ...] (también admite `-n` con sufijo "(Network)"). */
function parseIdeviceIds(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/\s*\((USB|Network)\)\s*$/i, ''));
}

function formatBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n); let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

module.exports = {
  parseAdbDevices, parseFastbootDevices, parseGetprop, parseDumpsysBattery,
  parseDf, parseIdeviceinfo, parseIdeviceIds, formatBytes,
};
