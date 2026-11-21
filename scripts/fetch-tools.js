'use strict';
// Descarga los binarios oficiales que se empaquetan con el instalador de Windows:
//  - Android SDK Platform-Tools (Google): adb.exe, fastboot.exe
//  - libimobiledevice para Windows (proyecto libimobiledevice-win32/imobiledevice-net)
// Uso: npm run fetch-tools
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'resources', 'bin');
const CACHE = path.join(__dirname, '..', '.cache');
const PLATFORM_TOOLS = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const IMD_RELEASES = 'https://api.github.com/repos/libimobiledevice-win32/imobiledevice-net/releases?per_page=10';

function get(url, { json = false, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'servicio-movil-build' };
    if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    https.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), { json, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url} → HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(json ? JSON.parse(buf.toString('utf8')) : buf);
      });
    }).on('error', reject);
  });
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    // bsdtar viene con Windows 10/11 y abre .zip; evita los fallos de Expand-Archive entre PowerShell 5 y 7.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-o', '-q', zip, '-d', dest], { stdio: 'inherit' });
  }
}

async function download(url, name) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  console.log(`↓ ${url}`);
  fs.writeFileSync(file, await get(url));
  return file;
}

async function platformTools() {
  const zip = await download(PLATFORM_TOOLS, 'platform-tools.zip');
  fs.rmSync(path.join(BIN, 'platform-tools'), { recursive: true, force: true });
  unzip(zip, BIN); // el zip ya contiene la carpeta platform-tools/
  if (!fs.existsSync(path.join(BIN, 'platform-tools', 'adb.exe'))) throw new Error('adb.exe no está en el zip de platform-tools');
}

// Driver USB oficial de Google (necesario en Windows para Pixel/Nexus en ADB y Fastboot).
async function googleUsbDriver() {
  let name = 'usb_driver_r13-windows.zip';
  try {
    const xml = (await get('https://dl.google.com/android/repository/addon2-1.xml')).toString('utf8');
    const all = [...xml.matchAll(/usb_driver_r(\d+)-windows\.zip/g)].sort((a, b) => Number(b[1]) - Number(a[1]));
    if (all.length) name = all[0][0];
  } catch (e) { console.warn(`No se pudo leer el índice del SDK (${e.message}); uso ${name}`); }
  const zip = await download(`https://dl.google.com/android/repository/${name}`, 'usb_driver.zip');
  const dest = path.join(BIN, 'google-usb-driver');
  fs.rmSync(dest, { recursive: true, force: true });
  unzip(zip, BIN); // el zip trae la carpeta usb_driver/
  fs.renameSync(path.join(BIN, 'usb_driver'), dest);
  if (!fs.existsSync(path.join(dest, 'android_winusb.inf'))) throw new Error('android_winusb.inf no está en el zip del driver USB de Google');
  console.log(`✓ Driver USB de Google (${name})`);
}

// Lista oficial de dispositivos de Google Play → nombres comerciales («Samsung Galaxy S24 Ultra»).
async function deviceNames() {
  const { buildDb } = require('../src/main/devicenames');
  const raw = await get('https://storage.googleapis.com/play_public/supported_devices.csv');
  const text = raw[0] === 0xff && raw[1] === 0xfe ? new TextDecoder('utf-16le').decode(raw) : raw.toString('utf8');
  const db = buildDb(text);
  const n = Object.keys(db.m).length;
  if (n < 10000) throw new Error(`Lista de dispositivos sospechosamente corta (${n})`);
  fs.mkdirSync(path.join(BIN, 'data'), { recursive: true });
  fs.writeFileSync(path.join(BIN, 'data', 'android-models.json'), JSON.stringify(db));
  console.log(`✓ Nombres comerciales: ${n} modelos`);
}

async function libimobiledevice() {
  const releases = await get(IMD_RELEASES, { json: true });
  let asset = null;
  for (const r of releases) {
    asset = (r.assets || []).find((a) => /win-x64\.zip$/i.test(a.name));
    if (asset) { console.log(`libimobiledevice: ${r.tag_name} (${asset.name})`); break; }
  }
  if (!asset) throw new Error('No se encontró un build win-x64 de libimobiledevice');
  const zip = await download(asset.browser_download_url, 'libimobiledevice.zip');
  const dest = path.join(BIN, 'libimobiledevice');
  fs.rmSync(dest, { recursive: true, force: true });
  unzip(zip, dest);
  // Algunos zips traen una subcarpeta: aplanar si idevice_id.exe no está en la raíz.
  if (!fs.existsSync(path.join(dest, 'idevice_id.exe'))) {
    const sub = fs.readdirSync(dest).map((d) => path.join(dest, d)).find((d) => fs.existsSync(path.join(d, 'idevice_id.exe')));
    if (!sub) throw new Error('idevice_id.exe no está en el zip de libimobiledevice');
    for (const f of fs.readdirSync(sub)) fs.renameSync(path.join(sub, f), path.join(dest, f));
    fs.rmSync(sub, { recursive: true, force: true });
  }
}

(async () => {
  await platformTools();
  await googleUsbDriver();
  await deviceNames();
  // En Windows con MSYS2 (runner de GitHub) se usa libimobiledevice actual vía
  // scripts/bundle-libimobiledevice.sh. Este build antiguo (1.2.1) queda solo como respaldo.
  if (process.argv.includes('--skip-ios')) return console.log(`✓ platform-tools listo en ${BIN}`);
  await libimobiledevice();
  console.log(`✓ Herramientas listas en ${BIN}`);
})().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
