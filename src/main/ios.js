'use strict';
// Funciones de servicio iPhone/iPad sobre libimobiledevice (sin tocar activación ni bloqueos).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tools = require('./tools');
const analysis = require('./loganalysis');
const P = require('./parsers');
const names = require('./devicenames');

async function listDevices() {
  try {
    const { stdout } = await tools.run('idevice_id', ['-l'], { timeout: 8000 });
    const ids = P.parseIdeviceIds(stdout);
    const devices = await Promise.all(ids.map(async (udid) => {
      try {
        const { stdout: s } = await tools.run('ideviceinfo', ['-u', udid, '-s'], { timeout: 8000 });
        const i = P.parseIdeviceinfo(s);
        return { platform: 'ios', serial: udid, state: 'device', model: i.DeviceName || i.ProductType || 'iPhone/iPad', marketName: names.iosMarketName(i.ProductType) };
      } catch (e) {
        // Sin emparejar: el usuario debe pulsar "Confiar" en el dispositivo.
        return { platform: 'ios', serial: udid, state: 'unpaired', model: 'Pulsa «Confiar» en el dispositivo', error: e.message };
      }
    }));
    return { devices, error: null };
  } catch (e) {
    return { devices: [], error: e.message };
  }
}

async function domain(udid, name) {
  try {
    const { stdout } = await tools.run('ideviceinfo', ['-u', udid, '-q', name], { timeout: 10000 });
    return P.parseIdeviceinfo(stdout);
  } catch { return {}; }
}

async function getInfo(udid) {
  const [{ stdout }, battery, disk] = await Promise.all([
    tools.run('ideviceinfo', ['-u', udid], { timeout: 15000 }),
    domain(udid, 'com.apple.mobile.battery'),
    domain(udid, 'com.apple.disk_usage'),
  ]);
  const i = P.parseIdeviceinfo(stdout);
  const total = Number(disk.TotalDataCapacity || disk.TotalDiskCapacity) || null;
  const free = Number(disk.TotalDataAvailable) || null;
  return {
    platform: 'ios',
    serial: udid,
    name: i.DeviceName || null,
    model: i.ProductType || null,
    marketName: names.iosMarketName(i.ProductType),
    modelNumber: i.ModelNumber ? `${i.ModelNumber}${i.RegionInfo || ''}` : null,
    iosVersion: i.ProductVersion || null,
    buildId: i.BuildVersion || null,
    serialNumber: i.SerialNumber || null,
    activationState: i.ActivationState || null, // solo lectura, informativo
    cpu: i.CPUArchitecture || null,
    battery: {
      level: battery.BatteryCurrentCapacity !== undefined ? Number(battery.BatteryCurrentCapacity) : null,
      status: battery.BatteryIsCharging === 'true' ? 'Cargando' : (battery.BatteryIsCharging === 'false' ? 'Descargando' : null),
    },
    storage: total ? { totalBytes: total, freeBytes: free, usedBytes: free !== null ? total - free : null } : null,
  };
}

async function screenshot(udid, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `captura-${udid.slice(0, 8)}-${Date.now()}.png`);
  await tools.run('idevicescreenshot', ['-u', udid, file], { timeout: 20000 });
  return file;
}

async function syslogDump(udid, seconds = 10) {
  return new Promise((resolve) => {
    let buf = '';
    const child = tools.stream('idevicesyslog', ['-u', udid], (t) => { buf += t; });
    const end = () => { try { child.kill(); } catch {} resolve(buf); };
    child.on('error', (e) => resolve(`Error: ${e.message}`));
    setTimeout(end, Math.max(2, Math.min(60, Number(seconds) || 10)) * 1000);
  });
}

/** Copia (sin borrarlos del iPhone: -k) los informes de fallo y los analiza junto con el syslog. */
async function crashReports(udid) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvr-crash-'));
  try {
    await tools.run('idevicecrashreport', ['-u', udid, '-k', '-e', dir], { timeout: 90000 }).catch(() => null);
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(f); } };
    walk(dir);
    return out.map((f) => ({ name: path.basename(f), text: /panic/i.test(f) ? fs.readFileSync(f, 'utf8').slice(0, 65536) : '' }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function logAnalysis(udid, syslogText) {
  const reports = await crashReports(udid).catch(() => []);
  return analysis.analyzeIos(syslogText, reports);
}

module.exports = { listDevices, getInfo, screenshot, syslogDump, crashReports, logAnalysis };
