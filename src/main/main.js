'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execFile } = require('node:child_process');
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
const diagnostics = require('./diagnostics');
const apps = require('./apps');
const migration = require('./migrate');
const deviceArt = require('./deviceart');
const components = require('./components');
const reset = require('./reset');
const repair = require('./repair');
const library = require('./library');
const settings = require('./settings');

log.initialize();
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'MVR Servicio Móvil',
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
  tools.available('idevicebackup2', ['--version']),
  tools.available('idevicediagnostics', ['--version']),
  tools.available('ideviceinstaller', ['--version']),
]));
handle('app:version', () => app.getVersion());
handle('device:analyzeLogs', (platform, serial, text) => (platform === 'ios' ? ios.logAnalysis(serial, text) : android.logAnalysis(serial)));
handle('diag:components', (platform, serial) => (platform === 'ios' ? components.iosComponents(serial) : components.androidComponents(serial)));
handle('diag:test', (serial, test, on) => components.androidTest(serial, test, on));
handle('diag:factoryMenu', (manufacturer) => components.factoryMenu(manufacturer));
handle('reset:check', (serial) => reset.androidCheck(serial));
handle('reset:openScreen', (serial) => reset.androidOpenResetScreen(serial));
handle('reset:openAccounts', (serial) => reset.androidOpenAccounts(serial));
handle('reset:recovery', (serial) => reset.androidToRecovery(serial));
handle('reset:fastbootState', (serial) => reset.fastbootUnlocked(serial));
handle('reset:fastbootWipe', (serial, confirm) => reset.fastbootWipe(serial, confirm));
handle('reset:iosRecovery', (udid, confirm) => reset.iosEnterRecovery(udid, confirm));
handle('diag:battery', (platform, serial) => (platform === 'ios' ? diagnostics.iosBattery(serial) : diagnostics.androidBattery(serial)));
const reportsDir = () => path.join(outDir(), 'Informes');
/** Solo se actúa sobre PDF de la carpeta de informes. */
function reportFile(f) {
  const file = path.resolve(String(f || ''));
  if (path.dirname(file) !== path.resolve(reportsDir()) || !file.endsWith('.pdf') || !fs.existsSync(file)) throw new Error('Informe no encontrado');
  return file;
}
handle('diag:report', async (platform, serial, extra = {}) => {
  const info = await mod(platform).getInfo(serial);
  const battery = await (platform === 'ios' ? diagnostics.iosBattery(serial) : diagnostics.androidBattery(serial)).catch(() => null);
  const parts = Array.isArray(extra.components) ? extra.components
    : await (platform === 'ios' ? components.iosComponents(serial) : components.androidComponents(serial)).catch(() => null);
  const html = diagnostics.reportHtml(info, battery, { components: parts, analysis: extra.analysis || null });
  fs.mkdirSync(reportsDir(), { recursive: true });
  const file = path.join(reportsDir(), diagnostics.reportName(info, 'pdf'));
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    fs.writeFileSync(file, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
  } finally { w.destroy(); }
  return { file, name: path.basename(file), device: info.marketName || info.model || serial };
});
handle('report:open', (f) => shell.openPath(reportFile(f)).then((e) => { if (e) throw new Error(e); return true; }));
handle('report:show', (f) => { shell.showItemInFolder(reportFile(f)); return true; });
handle('report:saveAs', async (f) => {
  const src = reportFile(f);
  const r = await dialog.showSaveDialog(win, { title: 'Guardar informe en PDF', defaultPath: path.join(app.getPath('desktop'), path.basename(src)), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.copyFileSync(src, r.filePath);
  return r.filePath;
});
/** Copia el PDF como archivo al portapapeles de Windows (Set-Clipboard): se pega con Ctrl+V en WhatsApp, correo o una carpeta. */
async function copyFileToClipboard(file) {
  if (process.platform !== 'win32') throw new Error('Solo disponible en Windows');
  const lit = file.replace(/'/g, "''");
  await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${lit}'`],
    { windowsHide: true, timeout: 15000 }, (err) => (err ? reject(new Error('No se pudo copiar el PDF al portapapeles')) : resolve())));
  return true;
}
/** Copia el PDF; si Windows no lo permite, abre la carpeta con el PDF marcado para arrastrarlo. */
async function copyOrShow(file) {
  try { await copyFileToClipboard(file); return 'copied'; } catch (e) { log.warn(e); shell.showItemInFolder(file); return 'folder'; }
}
handle('report:copy', (f) => copyFileToClipboard(reportFile(f)));
handle('report:whatsapp', async (f) => {
  const how = await copyOrShow(reportFile(f));
  await shell.openExternal('whatsapp://').catch(() => shell.openExternal('https://web.whatsapp.com/'));
  return how;
});
handle('report:email', async (f, device) => {
  const how = await copyOrShow(reportFile(f));
  const subject = encodeURIComponent(`Informe de diagnóstico · ${device || ''}`.trim());
  const body = encodeURIComponent('Hola,\n\nTe adjunto el informe de diagnóstico de tu dispositivo.\n\nUn saludo.');
  await shell.openExternal(`mailto:?subject=${subject}&body=${body}`);
  return how;
});
handle('report:toPhone', async (f, platform, serial) => {
  const file = reportFile(f);
  if (platform !== 'android') throw new Error('Apple no permite copiar archivos sueltos al iPhone por cable. Envíalo por WhatsApp o correo.');
  const dest = `/sdcard/Download/${path.basename(file)}`;
  await tools.run('adb', ['-s', serial, 'push', file, dest], { timeout: 60000 });
  return dest;
});
handle('apps:list', (platform, serial, opts) => (platform === 'ios' ? apps.iosList(serial, opts) : apps.androidList(serial, opts)));
handle('apps:uninstall', async (platform, serial, id, opts = {}) => {
  const ok = await confirm(`¿Desinstalar ${id}?`, opts.system && platform === 'android'
    ? 'Es una app del sistema: se quitará solo para el usuario (se puede recuperar con «Recuperar app del sistema»).'
    : 'Se borrarán la app y sus datos del teléfono.');
  if (!ok) return null;
  return platform === 'ios' ? apps.iosUninstall(serial, id) : apps.androidUninstall(serial, id, opts);
});
handle('apps:setEnabled', (serial, id, enabled) => apps.androidSetEnabled(serial, id, enabled));
handle('apps:restoreSystem', (serial, id) => apps.androidRestoreSystemApp(serial, id));
handle('apps:backup', async (serial, ids) => {
  const dest = await pickDir('Carpeta donde guardar los APK', path.join(outDir(), 'Apps'));
  if (!dest) return null;
  for (const id of ids) await apps.androidBackupApk(serial, id, dest);
  shell.openPath(dest);
  return { dest, count: ids.length };
});
handle('apps:install', async (platform, serial) => {
  const ios = platform === 'ios';
  const r = await dialog.showOpenDialog(win, { title: ios ? 'App para instalar (.ipa)' : 'APK para instalar (varios = una app dividida)', properties: ios ? ['openFile'] : ['openFile', 'multiSelections'], filters: [ios ? { name: 'IPA', extensions: ['ipa'] } : { name: 'APK', extensions: ['apk'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  return ios ? apps.iosInstall(serial, r.filePaths[0]) : apps.androidInstall(serial, r.filePaths);
});
handle('migrate:plan', (from, to) => migration.plan(from, to));
handle('migrate:run', async (id, src, dst, opts) => {
  const ok = await confirm('¿Empezar a pasar los datos?', 'Mantén los dos teléfonos conectados y desbloqueados hasta que termine. En el destino se añaden los datos; no se borra nada.');
  if (!ok) return null;
  const work = path.join(outDir(), 'Migraciones', stamp());
  try {
    return await migration.migrate(src, dst, opts, work, progressFor(id), (child) => jobs.set(id, child));
  } finally { jobs.delete(id); }
});
const photosDir = () => path.join(app.getPath('userData'), 'fotos-dispositivos');
handle('art:preview', (platform, serial) => deviceArt.screenPreview(platform, serial));
handle('art:photo', (name) => deviceArt.getPhoto(photosDir(), name));
handle('art:setPhoto', async (name) => {
  const r = await dialog.showOpenDialog(win, { title: `Foto para ${name}`, properties: ['openFile'], filters: [{ name: 'Imagen', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return deviceArt.setPhoto(photosDir(), name, r.filePaths[0]);
});
handle('art:removePhoto', (name) => deviceArt.removePhoto(photosDir(), name));
handle('art:kind', (info) => deviceArt.frameKind(info));
const libRoot = () => path.join(outDir(), 'Biblioteca');
handle('repair:device', (name) => repair.deviceInfo(name));
handle('repair:guide', (id) => repair.guide(id));
handle('repair:search', (name, es, en) => repair.repairSearch(name, es, en));
handle('repair:links', (name) => repair.searchLinks(name, settings.load(app.getPath('userData')).schematicSites));
handle('settings:get', () => settings.load(app.getPath('userData')));
handle('settings:set', (patch) => settings.save(app.getPath('userData'), patch));
handle('open:url', (url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Solo se abren enlaces https');
  return shell.openExternal(u.toString()).then(() => true);
});
handle('library:list', (name) => library.list(libRoot(), name));
handle('library:add', async (name) => {
  const r = await dialog.showOpenDialog(win, { title: `Añadir esquemas o manuales de ${name}`, properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return null;
  return library.add(libRoot(), name, r.filePaths);
});
handle('library:open', (name, file) => shell.openPath(library.fileFor(libRoot(), name, file)).then((e) => { if (e) throw new Error(e); return true; }));
handle('library:folder', (name) => { const d = library.dirFor(libRoot(), name); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d).then(() => d); });
handle('tools:restartAdb', () => diagnostics.restartAdb());
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
