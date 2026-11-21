'use strict';
// Gestor de apps: Android (pm/adb) e iPhone (ideviceinstaller).
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');
const P = require('./parsers');

// ── Android ─────────────────────────────────────────────────────────────────
/** `pm list packages -f --show-versioncode` → [{id, path, versionCode}] */
function parsePmList(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^package:(.+)=([\w.]+)(?:\s+versionCode:(\d+))?\s*$/.exec(line.trim());
    if (m) out.push({ id: m[2], path: m[1], versionCode: m[3] ? Number(m[3]) : null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function androidList(serial, { system = false } = {}) {
  const sh = (c) => tools.run('adb', ['-s', serial, 'shell', c]).then((r) => r.stdout);
  const [apps, disabled] = await Promise.all([
    sh(`pm list packages -f --show-versioncode ${system ? '-s' : '-3'}`),
    sh(`pm list packages -d ${system ? '-s' : '-3'}`),
  ]);
  const off = new Set(P.parsePmPackages(disabled));
  return parsePmList(apps).map((a) => ({ ...a, name: a.id, system, enabled: !off.has(a.id) }));
}

const PKG_RE = /^[A-Za-z][\w]*(\.[A-Za-z0-9_]+)+$/;
function checkPkg(id) { if (!PKG_RE.test(id)) throw new Error(`Identificador de app no válido: ${id}`); return id; }

async function androidUninstall(serial, id, { system = false } = {}) {
  checkPkg(id);
  // Las apps del sistema no se pueden borrar sin root: se desinstalan solo para el usuario (reversible).
  const args = system ? ['shell', `pm uninstall -k --user 0 ${id}`] : ['uninstall', id];
  const { stdout } = await tools.run('adb', ['-s', serial, ...args], { timeout: 120000 });
  if (!/Success/.test(stdout)) throw new Error(stdout.trim() || 'No se pudo desinstalar');
  return true;
}

async function androidSetEnabled(serial, id, enabled) {
  checkPkg(id);
  const cmd = enabled ? `pm enable ${id}` : `pm disable-user --user 0 ${id}`;
  const { stdout } = await tools.run('adb', ['-s', serial, 'shell', cmd]);
  if (!/new state: (enabled|disabled)/i.test(stdout)) throw new Error(stdout.trim() || 'No se pudo cambiar el estado');
  return enabled;
}

/** Vuelve a instalar una app del sistema desinstalada para el usuario. */
async function androidRestoreSystemApp(serial, id) {
  checkPkg(id);
  const { stdout } = await tools.run('adb', ['-s', serial, 'shell', `cmd package install-existing ${id}`]);
  if (!/installed for user|Success/i.test(stdout)) throw new Error(stdout.trim());
  return true;
}

async function androidBackupApk(serial, id, dest) {
  checkPkg(id);
  const { stdout } = await tools.run('adb', ['-s', serial, 'shell', `pm path ${id}`]);
  const paths = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('package:')).map((l) => l.slice(8));
  if (!paths.length) throw new Error('No se encontró el APK');
  const dir = path.join(dest, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const p of paths) await tools.run('adb', ['-s', serial, 'pull', p, dir], { timeout: 0 });
  return { dir, files: paths.length };
}

/** Instala uno o varios APK (varios = split APK de una misma app). */
async function androidInstall(serial, files) {
  const apks = files.filter((f) => /\.apk$/i.test(f));
  if (!apks.length) throw new Error('Selecciona archivos .apk');
  const args = apks.length === 1 ? ['install', '-r', apks[0]] : ['install-multiple', '-r', ...apks];
  const { stdout } = await tools.run('adb', ['-s', serial, ...args], { timeout: 10 * 60000 });
  if (!/Success/.test(stdout)) throw new Error(stdout.trim());
  return apks.length;
}

// ── iPhone ──────────────────────────────────────────────────────────────────
let iiSyntax = null; // 'new' (ideviceinstaller ≥1.2: subcomandos) o 'old' (-l/-i/-U)
async function syntax() {
  if (iiSyntax) return iiSyntax;
  let help = '';
  try { help = (await tools.run('ideviceinstaller', ['--help'], { timeout: 8000 })).stdout; } catch (e) { help = e.message; }
  iiSyntax = /\bCOMMAND\b/.test(help) || /^\s*list\b/m.test(help) ? 'new' : 'old';
  return iiSyntax;
}
function resetSyntax() { iiSyntax = null; }

/** Salida CSV de `ideviceinstaller list`: CFBundleIdentifier, CFBundleShortVersionString, CFBundleDisplayName */
function parseIosApps(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (!l || /^CFBundleIdentifier/i.test(l) || /^Total:/i.test(l)) continue;
    const m = /^([^,\s]+),\s*"?([^",]*)"?,\s*"?(.*?)"?\s*$/.exec(l);
    if (m) out.push({ id: m[1], version: m[2] || null, name: m[3] || m[1] });
    else if (/^[\w.-]+\s+-\s+/.test(l)) { const [id, rest] = l.split(/\s+-\s+/); out.push({ id, version: null, name: rest }); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

async function iosList(udid, { system = false } = {}) {
  const s = await syntax();
  const args = s === 'new' ? ['-u', udid, 'list', system ? '--system' : '--user'] : ['-u', udid, '-l', '-o', system ? 'list_system' : 'list_user'];
  const { stdout } = await tools.run('ideviceinstaller', args, { timeout: 60000 });
  return parseIosApps(stdout).map((a) => ({ ...a, system, enabled: true }));
}

const BUNDLE_RE = /^[A-Za-z0-9][\w.-]*$/;
async function iosUninstall(udid, id) {
  if (!BUNDLE_RE.test(id)) throw new Error(`Identificador no válido: ${id}`);
  const s = await syntax();
  await tools.run('ideviceinstaller', s === 'new' ? ['-u', udid, 'uninstall', id] : ['-u', udid, '-U', id], { timeout: 120000 });
  return true;
}

/** Instala un .ipa firmado para este dispositivo (App Store descifrado no funciona: lo impide iOS). */
async function iosInstall(udid, file) {
  if (!/\.ipa$/i.test(file) || !fs.existsSync(file)) throw new Error('Selecciona un archivo .ipa');
  const s = await syntax();
  try {
    await tools.run('ideviceinstaller', s === 'new' ? ['-u', udid, 'install', file] : ['-u', udid, '-i', file], { timeout: 10 * 60000 });
  } catch (e) {
    if (/ApplicationVerificationFailed|signature|provision/i.test(e.message)) throw new Error('iOS rechazó la app: el .ipa no está firmado para este iPhone (perfil de aprovisionamiento).');
    throw e;
  }
  return true;
}

module.exports = {
  parsePmList, parseIosApps, androidList, androidUninstall, androidSetEnabled, androidRestoreSystemApp,
  androidBackupApk, androidInstall, iosList, iosUninstall, iosInstall, resetSyntax,
};
