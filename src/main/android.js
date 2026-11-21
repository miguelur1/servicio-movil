'use strict';
// Funciones de servicio Android sobre ADB / Fastboot oficiales.
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');
const analysis = require('./loganalysis');
const P = require('./parsers');
const names = require('./devicenames');

const REBOOT_MODES = new Set(['system', 'recovery', 'bootloader', 'sideload']);

async function listDevices() {
  const [adb, fb] = await Promise.allSettled([
    tools.run('adb', ['devices', '-l']),
    tools.run('fastboot', ['devices'], { timeout: 8000 }),
  ]);
  const devices = [];
  if (adb.status === 'fulfilled') {
    for (const d of P.parseAdbDevices(adb.value.stdout)) {
      const hit = d.model || d.device ? names.androidMarketName({ 'ro.product.model': d.model, 'ro.product.device': d.device }) : null;
      devices.push({ platform: 'android', ...d, marketName: hit && hit.source === 'google' ? hit.name : null });
    }
  }
  if (fb.status === 'fulfilled') {
    for (const d of P.parseFastbootDevices(fb.value.stdout)) devices.push({ platform: 'android', ...d, state: 'fastboot' });
  }
  return { devices, error: adb.status === 'rejected' ? adb.reason.message : null };
}

const shell = (serial, cmd) => tools.run('adb', ['-s', serial, 'shell', ...cmd]).then((r) => r.stdout);

async function getInfo(serial) {
  const [props, battery, df] = await Promise.all([
    shell(serial, ['getprop']).then(P.parseGetprop),
    shell(serial, ['dumpsys', 'battery']).then(P.parseDumpsysBattery).catch(() => null),
    shell(serial, ['df', '-k', '/data']).then(P.parseDf).catch(() => null),
  ]);
  return {
    platform: 'android',
    serial,
    marketName: names.androidMarketName(props).name,
    manufacturer: props['ro.product.manufacturer'] || null,
    brand: props['ro.product.brand'] || null,
    model: props['ro.product.model'] || null,
    device: props['ro.product.device'] || null,
    androidVersion: props['ro.build.version.release'] || null,
    sdk: props['ro.build.version.sdk'] || null,
    securityPatch: props['ro.build.version.security_patch'] || null,
    buildId: props['ro.build.display.id'] || props['ro.build.id'] || null,
    fingerprint: props['ro.build.fingerprint'] || null,
    hardware: props['ro.hardware'] || null,
    abi: props['ro.product.cpu.abi'] || null,
    bootloaderLocked: props['ro.boot.flash.locked'] === undefined ? null : props['ro.boot.flash.locked'] === '1',
    verifiedBoot: props['ro.boot.verifiedbootstate'] || null,
    battery,
    storage: df,
  };
}

async function screenshot(serial, outDir) {
  const { stdout } = await tools.run('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' });
  if (!stdout || stdout.length < 8 || stdout.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('El dispositivo no devolvió una imagen PNG válida (¿pantalla bloqueada o DRM?).');
  }
  const file = path.join(outDir, `captura-${serial}-${Date.now()}.png`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, stdout);
  return file;
}

async function installApk(serial, apkPath) {
  if (!/\.apk$/i.test(apkPath) || !fs.existsSync(apkPath)) throw new Error('Selecciona un archivo .apk existente.');
  const { stdout } = await tools.run('adb', ['-s', serial, 'install', '-r', apkPath], { timeout: 5 * 60000 });
  if (!/Success/.test(stdout)) throw new Error(stdout.trim() || 'Instalación fallida');
  return stdout.trim();
}

async function reboot(serial, mode = 'system', fromFastboot = false) {
  if (!REBOOT_MODES.has(mode)) throw new Error(`Modo de reinicio no válido: ${mode}`);
  if (fromFastboot) {
    const args = mode === 'bootloader' ? ['reboot-bootloader'] : ['reboot', ...(mode === 'system' ? [] : [mode])];
    await tools.run('fastboot', ['-s', serial, ...args]);
  } else {
    await tools.run('adb', ['-s', serial, 'reboot', ...(mode === 'system' ? [] : [mode])]);
  }
  return true;
}

/** Volcado de logcat (los últimos N registros), sin dejar proceso abierto. */
async function logcatDump(serial, lines = 2000) {
  const n = Math.max(100, Math.min(20000, Number(lines) || 2000));
  const { stdout } = await tools.run('adb', ['-s', serial, 'logcat', '-d', '-t', String(n), '-v', 'time']);
  return stdout;
}

/** Recoge más registro para el análisis: búfer de fallos, eventos, motivo de arranque e historial (dropbox). */
async function logAnalysis(serial) {
  const out = (args, timeout = 30000) => tools.run('adb', ['-s', serial, ...args], { timeout }).then((r) => r.stdout).catch(() => '');
  const [crash, main, events, reason, dropbox] = await Promise.all([
    out(['logcat', '-d', '-b', 'crash', '-v', 'time']),
    out(['logcat', '-d', '-b', 'main,system', '-t', '20000', '-v', 'time']),
    out(['logcat', '-d', '-b', 'events', '-t', '5000', '-v', 'time']),
    out(['shell', 'getprop sys.boot.reason; getprop ro.boot.bootreason']),
    out(['shell', 'dumpsys dropbox']),
  ]);
  const br = reason.split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
  return analysis.analyzeAndroid([crash, main, events].join('\n'), { bootReason: br, dropbox });
}

module.exports = { listDevices, getInfo, screenshot, installApk, reboot, logcatDump, logAnalysis, REBOOT_MODES };
