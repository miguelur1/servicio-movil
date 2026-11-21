'use strict';
// Imagen del dispositivo: vista previa de la pantalla en directo y foto propia por modelo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require('./tools');

const MAX_PHOTO = 8 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Clave de archivo para un modelo: «Samsung Galaxy S10» → samsung-galaxy-s10 */
function photoKey(name) {
  return String(name || 'dispositivo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'dispositivo';
}

function findPhoto(dir, key) {
  for (const ext of Object.keys(MIME)) {
    const f = path.join(dir, `${key}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function getPhoto(dir, name) {
  const f = findPhoto(dir, photoKey(name));
  if (!f) return null;
  return `data:${MIME[path.extname(f).toLowerCase()]};base64,${fs.readFileSync(f).toString('base64')}`;
}

function setPhoto(dir, name, source) {
  const ext = path.extname(source).toLowerCase();
  if (!MIME[ext]) throw new Error('Usa una imagen PNG, JPG o WEBP.');
  if (fs.statSync(source).size > MAX_PHOTO) throw new Error('La imagen es demasiado grande (máximo 8 MB).');
  fs.mkdirSync(dir, { recursive: true });
  const key = photoKey(name);
  for (const e of Object.keys(MIME)) fs.rmSync(path.join(dir, `${key}${e}`), { force: true });
  fs.copyFileSync(source, path.join(dir, `${key}${ext}`));
  return getPhoto(dir, name);
}

function removePhoto(dir, name) {
  const key = photoKey(name);
  for (const e of Object.keys(MIME)) fs.rmSync(path.join(dir, `${key}${e}`), { force: true });
  return true;
}

const isPng = (b) => b && b.length > 8 && b.readUInt32BE(0) === 0x89504e47;

/** Captura de la pantalla en memoria (data URL) para mostrarla dentro de la silueta. null si no se puede. */
async function screenPreview(platform, serial) {
  try {
    if (platform === 'ios') {
      const f = path.join(os.tmpdir(), `mvr-prev-${process.pid}-${Date.now()}.png`);
      await tools.run('idevicescreenshot', ['-u', serial, f], { timeout: 15000 });
      const b = fs.readFileSync(f); fs.rmSync(f, { force: true });
      return b.length ? `data:${isPng(b) ? 'image/png' : 'image/tiff'};base64,${b.toString('base64')}` : null;
    }
    const { stdout } = await tools.run('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 15000 });
    return isPng(stdout) ? `data:image/png;base64,${stdout.toString('base64')}` : null;
  } catch { return null; }
}

/** Qué silueta dibujar según el modelo. */
function frameKind(info) {
  if (!info) return 'android';
  if (info.platform === 'ios') {
    const t = String(info.model || '');
    if (/^iPad/.test(t)) return 'ipad';
    const m = /^iPhone(\d+),(\d+)/.exec(t);
    if (!m) return 'iphone-notch';
    const [maj, min] = [Number(m[1]), Number(m[2])];
    if (maj <= 10 && !(maj === 10 && (min === 3 || min === 6))) return 'iphone-home';
    if (maj === 12 && min === 8) return 'iphone-home'; // SE 2
    if (maj === 14 && min === 6) return 'iphone-home'; // SE 3
    if (maj === 17 && min === 5) return 'iphone-notch'; // 16e
    if (maj >= 15) return 'iphone-island'; // 14 Pro en adelante y toda la serie 15+
    return 'iphone-notch';
  }
  return /pixel/i.test(`${info.model} ${info.marketName}`) ? 'pixel' : 'android';
}

module.exports = { photoKey, getPhoto, setPhoto, removePhoto, screenPreview, frameKind };
