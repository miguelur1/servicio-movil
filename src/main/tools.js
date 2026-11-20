'use strict';
// Localiza los binarios empaquetados (resources/bin) y ejecuta comandos sin shell.
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const isWin = process.platform === 'win32';

function binRoot() {
  // En la app instalada: <instalación>/resources/bin. En desarrollo: ./resources/bin.
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'bin'))) {
    return path.join(process.resourcesPath, 'bin');
  }
  return path.join(__dirname, '..', '..', 'resources', 'bin');
}

const SUBDIR = {
  adb: 'platform-tools',
  fastboot: 'platform-tools',
};

/** Ruta del ejecutable empaquetado o, si no existe, el nombre para buscarlo en PATH. */
function resolveTool(name) {
  const exe = isWin ? `${name}.exe` : name;
  const sub = SUBDIR[name] || 'libimobiledevice';
  const bundled = path.join(binRoot(), sub, exe);
  return fs.existsSync(bundled) ? bundled : exe;
}

/**
 * Ejecuta una herramienta y devuelve stdout. Nunca usa shell (sin inyección de argumentos).
 * @returns {Promise<{stdout: string|Buffer, stderr: string}>}
 */
function run(name, args, { timeout = 30000, encoding = 'utf8', maxBuffer = 64 * 1024 * 1024 } = {}) {
  const file = resolveTool(name);
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, encoding, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          err.message = `No se encontró "${name}". Ejecuta "npm run fetch-tools" o instala la herramienta.`;
        } else if (stderr) {
          err.message = String(stderr).trim() || err.message;
        }
        return reject(err);
      }
      resolve({ stdout, stderr: String(stderr || '') });
    });
  });
}

/** Lanza un proceso largo (logcat, backup) y entrega la salida línea a línea. */
function stream(name, args, onData) {
  const child = spawn(resolveTool(name), args, { windowsHide: true });
  child.stdout.on('data', (b) => onData(b.toString('utf8')));
  child.stderr.on('data', (b) => onData(b.toString('utf8')));
  return child;
}

async function available(name, args = ['version']) {
  try {
    await run(name, args, { timeout: 8000 });
    return { name, ok: true, path: resolveTool(name) };
  } catch (e) {
    return { name, ok: false, path: resolveTool(name), error: e.message };
  }
}

module.exports = { resolveTool, run, stream, available, binRoot };
