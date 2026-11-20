'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const log = require('electron-log/main');
const android = require('./android');
const ios = require('./ios');
const tools = require('./tools');
const updater = require('./updater');

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
handle('update:check', () => updater.check());
handle('update:install', () => updater.quitAndInstall());

app.whenReady().then(() => {
  createWindow();
  updater.init(win, log);
});
app.on('window-all-closed', () => app.quit());
