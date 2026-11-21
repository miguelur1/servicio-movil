'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const log = require('electron-log/main');
const android = require('./android');
const ios = require('./ios');
const tools = require('./tools');
const updater = require('./updater');
const androidData = require('./android-data');
const iosData = require('./ios-data');
const fs = require('node:fs');
const drivers = require('./drivers');

log.initialize();
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Servicio Móvil',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

const outDir = () => path.join(app.getPath('documents'), 'Servicio Movil');
const mod = (platform) => (platform === 'ios' ? ios : android);

// Envoltorio: devuelve {ok, data} o {ok:false, error} para que el renderer no reciba excepciones.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) {
      log.warn(`[${channel}]`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

handle('devices:list', async () => {
  const [a, i] = await Promise.all([android.listDevices(), ios.listDevices()]);
  return { devices: [...a.devices, ...i.devices], errors: { android: a.error, ios: i.error } };
});
handle('device:info', (platform, serial) => mod(platform).getInfo(serial));
handle('device:screenshot', async (platform, serial) => {
  const file = await mod(platform).screenshot(serial, outDir());
  shell.showItemInFolder(file);
  return file;
});
handle('android:install', async (serial) => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'APK', extensions: ['apk'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return android.installApk(serial, r.filePaths[0]);
});
handle('android:reboot', (serial, mode, fromFastboot) => android.reboot(serial, mode, fromFastboot));
handle('device:logs', (platform, serial) => (platform === 'ios' ? ios.syslogDump(serial, 10) : android.logcatDump(serial, 2000)));
handle('tools:status', () => Promise.all([
  tools.available('adb', ['version']),
  tools.available('fastboot', ['--version']),
  tools.available('idevice_id', ['--version']),
]));
handle('app:version', () => app.getVersion());
handle('drivers:google', () => drivers.installGoogleUsbDriver());
handle('app:platform', () => process.platform);
handle('update:check', () => updater.check());
handle('update:install', () => updater.quitAndInstall());

// ── Trabajos largos con progreso y cancelación ──────────────────────────────
const jobs = new Map(); // id → proceso hijo cancelable
const progressFor = (id) => (p) => { if (win && !win.isDestroyed()) win.webContents.send('job:progress', { id, ...p }); };
async function track(id, job) {
  if (job && job.child) jobs.set(id, job.child);
  try { return await (job && job.done ? job.done : job); } finally { jobs.delete(id); }
}
ipcMain.handle('job:cancel', (_e, id) => { const c = jobs.get(id); if (c) c.kill(); return !!c; });

const dirs = {
  copias: () => path.join(outDir(), 'Copias'),
  fotos: () => path.join(outDir(), 'Fotos'),
  datos: () => path.join(outDir(), 'Contactos y mensajes'),
};
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const safe = (s) => String(s || 'dispositivo').replace(/[^\w.-]+/g, '_');

async function pickDir(title, defaultPath) {
  fs.mkdirSync(defaultPath, { recursive: true });
  const r = await dialog.showOpenDialog(win, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}
async function confirm(message, detail) {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancelar', 'Continuar'], defaultId: 0, cancelId: 0, message, detail });
  return r.response === 1;
}

/** Última copia de este iPhone en la carpeta de copias, o null. */
function latestIosBackup(udid) {
  const found = iosData.findBackups(dirs.copias()).filter((b) => b.udid === udid && !b.encrypted);
  return found[0] ? found[0].dir : null;
}
/** Para extraer datos de iPhone hace falta una copia: usa la existente o crea una nueva. */
async function iosBackupFor(id, udid, fresh) {
  const existing = !fresh && latestIosBackup(udid);
  if (existing) return existing;
  const r = await track(id, iosData.backup(udid, dirs.copias(), progressFor(id)));
  if (r.encrypted) throw new Error('El iPhone tiene activado «Cifrar copia local»: la copia se ha hecho, pero cifrada. Desactívalo en iTunes/Dispositivos Apple para poder extraer fotos, contactos y mensajes.');
  return r.dir;
}

handle('data:backup', async (id, platform, serial, opts = {}) => {
  const base = await pickDir('Carpeta donde guardar la copia', dirs.copias());
  if (!base) return null;
  if (platform === 'ios') return track(id, iosData.backup(serial, base, progressFor(id)));
  return androidData.backup(serial, path.join(base, `${safe(opts.model)}-${serial}-${stamp()}`), { apps: !!opts.apps }, progressFor(id));
});

handle('data:restore', async (id, platform, serial) => {
  const src = await pickDir('Elige la copia que quieres restaurar', dirs.copias());
  if (!src) return null;
  if (platform === 'ios') {
    const found = iosData.findBackups(src);
    if (!found.length) throw new Error('En esa carpeta no hay ninguna copia de iPhone.');
    const b = found.find((x) => x.udid === serial) || found[0];
    const ok = await confirm('¿Restaurar esta copia en el iPhone?', `Copia de «${b.name || b.udid}» (${b.date || 'fecha desconocida'}). Se sustituirán los datos y ajustes actuales del iPhone. «Buscar mi iPhone» debe estar desactivado.`);
    if (!ok) return null;
    return track(id, iosData.restore(serial, path.dirname(b.dir), b.udid, progressFor(id)));
  }
  const ok = await confirm('¿Restaurar esta copia en el teléfono?', 'Se copiarán las carpetas y se instalarán las apps guardadas. Los archivos con el mismo nombre se sobrescribirán.');
  if (!ok) return null;
  return androidData.restore(serial, src, progressFor(id));
});

handle('data:photos', async (id, platform, serial, opts = {}) => {
  const base = await pickDir('Carpeta donde copiar las fotos', dirs.fotos());
  if (!base) return null;
  const dest = path.join(base, `${safe(opts.model)}-${stamp()}`);
  if (platform === 'ios') {
    const dir = await iosBackupFor(id, serial, opts.fresh);
    const r = await iosData.extractPhotos(dir, dest, progressFor(id));
    shell.openPath(dest);
    return r;
  }
  const r = await androidData.copyPhotos(serial, dest, progressFor(id));
  shell.openPath(dest);
  return r;
});

handle('data:sendPhotos', async (id, serial) => {
  const r = await dialog.showOpenDialog(win, { title: 'Fotos o vídeos para enviar al teléfono', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fotos y vídeos', extensions: ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'mp4', 'mov', '3gp', 'mkv'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  return androidData.sendPhotos(serial, r.filePaths, progressFor(id));
});

handle('data:contacts', async (id, platform, serial, opts = {}) => {
  const dest = path.join(dirs.datos(), `${safe(opts.model)}-${stamp()}`);
  const r = platform === 'ios'
    ? await iosData.exportContacts(await iosBackupFor(id, serial, opts.fresh), dest)
    : await androidData.exportContacts(serial, dest);
  shell.showItemInFolder(r.file);
  return r;
});

handle('data:messages', async (id, platform, serial, opts = {}) => {
  const dest = path.join(dirs.datos(), `${safe(opts.model)}-${stamp()}`);
  const r = platform === 'ios'
    ? await iosData.exportMessages(await iosBackupFor(id, serial, opts.fresh), dest)
    : await androidData.exportMessages(serial, dest);
  shell.showItemInFolder(r.file);
  return r;
});

handle('data:iosBackupInfo', (udid) => {
  const dir = latestIosBackup(udid);
  if (!dir) return null;
  return { dir, date: fs.statSync(path.join(dir, 'Manifest.db')).mtime.toISOString() };
});
handle('data:iosBrowse', (udid, text) => {
  const dir = latestIosBackup(udid);
  if (!dir) throw new Error('Todavía no hay una copia de este iPhone. Haz una copia primero.');
  return iosData.browse(dir, text);
});
handle('data:iosExtract', async (udid, ids) => {
  const dir = latestIosBackup(udid);
  const dest = await pickDir('Carpeta donde guardar los archivos', path.join(outDir(), 'Archivos'));
  if (!dest) return null;
  const r = await iosData.extractFiles(dir, ids, dest);
  shell.openPath(dest);
  return r;
});

handle('files:list', (serial, dir) => androidData.listDir(serial, dir));
handle('files:pull', async (serial, remotes) => {
  const dest = await pickDir('Carpeta donde guardar', path.join(outDir(), 'Archivos'));
  if (!dest) return null;
  await androidData.pullPaths(serial, remotes, dest);
  shell.openPath(dest);
  return dest;
});
handle('files:push', async (serial, remoteDir) => {
  const r = await dialog.showOpenDialog(win, { title: `Enviar a ${remoteDir}`, properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return null;
  return androidData.pushPaths(serial, r.filePaths, remoteDir);
});

app.whenReady().then(() => {
  createWindow();
  updater.init(win, log);
});
app.on('window-all-closed', () => app.quit());
