'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listDevices: () => ipcRenderer.invoke('devices:list'),
  info: (platform, serial) => ipcRenderer.invoke('device:info', platform, serial),
  screenshot: (platform, serial) => ipcRenderer.invoke('device:screenshot', platform, serial),
  logs: (platform, serial) => ipcRenderer.invoke('device:logs', platform, serial),
  installApk: (serial) => ipcRenderer.invoke('android:install', serial),
  reboot: (serial, mode, fromFastboot) => ipcRenderer.invoke('android:reboot', serial, mode, fromFastboot),
  toolsStatus: () => ipcRenderer.invoke('tools:status'),
  version: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
});
