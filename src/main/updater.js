'use strict';
// Auto-actualización desde GitHub Releases (electron-updater). Solo activa en la app instalada.
const { app } = require('electron');

let autoUpdater = null;
let win = null;

function send(status, extra = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('update:status', { status, ...extra });
}

function init(window, log) {
  win = window;
  if (!app.isPackaged) { send('dev'); return; }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }));
  autoUpdater.on('update-not-available', () => send('none'));
  autoUpdater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('ready', { version: i.version }));
  autoUpdater.on('error', (e) => send('error', { message: e.message }));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

async function check() {
  if (!autoUpdater) return 'dev';
  await autoUpdater.checkForUpdates();
  return 'checking';
}

function quitAndInstall() {
  if (autoUpdater) autoUpdater.quitAndInstall();
  return true;
}

module.exports = { init, check, quitAndInstall };
