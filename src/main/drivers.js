'use strict';
// Driver USB de Google para Pixel en Windows. Se instala con pnputil (herramienta de Windows),
// pidiendo permisos de administrador (aparece el aviso UAC).
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const tools = require('./tools');

const infPath = () => path.join(tools.binRoot(), 'google-usb-driver', 'android_winusb.inf');

/** Comando PowerShell que lanza pnputil elevado y espera a que termine. Devuelve el código de salida. */
function elevatedPnputilArgs(inf) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`; // comillas de PowerShell
  const inner = `$p = Start-Process -FilePath 'pnputil.exe' -ArgumentList @('/add-driver', ${q(`"${inf}"`)}, '/install') -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`;
  return ['-NoProfile', '-NonInteractive', '-Command', inner];
}

function installGoogleUsbDriver() {
  if (process.platform !== 'win32') return Promise.reject(new Error('El driver solo hace falta en Windows.'));
  const inf = infPath();
  if (!fs.existsSync(inf)) return Promise.reject(new Error('El driver de Google no está incluido en esta instalación.'));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', elevatedPnputilArgs(inf), { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
      // pnputil: 0 = instalado; 259 = ya estaba instalado / nada que hacer; 3010 = requiere reinicio.
      const code = err ? err.code : 0;
      if (code === 0 || code === 259) return resolve('Driver de Google instalado. Desconecta y vuelve a conectar el Pixel.');
      if (code === 3010) return resolve('Driver instalado. Reinicia Windows para terminar.');
      if (/canceled|cancelado|1223/i.test(`${stderr} ${err && err.message}`)) return reject(new Error('Instalación cancelada (no se aceptó el permiso de administrador).'));
      return reject(new Error(`No se pudo instalar el driver (código ${code}). ${String(stderr || '').trim()}`));
    });
  });
}

module.exports = { installGoogleUsbDriver, elevatedPnputilArgs, infPath };
