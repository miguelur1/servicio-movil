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

/**
 * Salida de `adb shell content query --uri … --projection a:b:c` → [{a, b, c}].
 * Las columnas se separan por ", clave=" usando solo las claves pedidas, así que un valor
 * puede contener comas. La última columna puede ocupar varias líneas (cuerpo de SMS).
 */
function parseContentQuery(text, keys) {
  const rows = [];
  const alt = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const split = new RegExp(`(?:^|, )(${alt})=`, 'g');
  let cur = null;
  const flush = () => {
    if (cur === null) return;
    const row = {};
    const marks = [];
    let m;
    split.lastIndex = 0;
    while ((m = split.exec(cur)) !== null) marks.push({ key: m[1], start: m.index, valStart: m.index + m[0].length });
    marks.forEach((mk, i) => {
      const v = cur.slice(mk.valStart, i + 1 < marks.length ? marks[i + 1].start : cur.length);
      row[mk.key] = v === 'NULL' ? null : v;
    });
    rows.push(row);
  };
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^Row: \d+ (.*)$/.exec(line);
    if (m) { flush(); cur = m[1]; } else if (cur !== null) cur += `\n${line}`;
  }
  flush();
  // Quita el salto final que deja la última línea vacía de la salida.
  for (const r of rows) for (const k of keys) if (typeof r[k] === 'string') r[k] = r[k].replace(/\n+$/, '');
  return rows;
}

/** `stat -c '%F|%s|%Y|%n'` (toybox) → [{name, path, dir, size, mtime}] ordenado: carpetas primero. */
function parseStatList(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const p = line.split('|');
    if (p.length < 4) continue;
    const [type, size, mtime, ...rest] = p;
    const full = rest.join('|');
    const name = full.replace(/\/+$/, '').split('/').pop();
    if (!name || name === '.' || name === '..' || name === '*' || name === '.*') continue;
    out.push({ name, path: full, dir: /directory/.test(type), link: /symbolic link/.test(type), size: Number(size) || 0, mtime: Number(mtime) * 1000 || null });
  }
  return out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

/** Línea de progreso de idevicebackup2: "[=====    ]  42% Finished" → 42 */
function parseBackupProgress(line) {
  const m = /(\d{1,3}(?:\.\d+)?)% Finished/.exec(line);
  return m ? Math.min(100, Math.round(Number(m[1]))) : null;
}

/** `pm list packages -3` → ['com.whatsapp', …] */
function parsePmPackages(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('package:')).map((l) => l.slice(8)).sort();
}

module.exports.parseContentQuery = parseContentQuery;
module.exports.parseStatList = parseStatList;
module.exports.parseBackupProgress = parseBackupProgress;
module.exports.parsePmPackages = parsePmPackages;
