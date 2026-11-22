'use strict';
// Ver y controlar la pantalla de un Android desde el PC (scrcpy por USB).
// Necesita la depuración USB ya autorizada en ese PC: no se salta ningún bloqueo.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');

const running = new Map(); // serial → child

function buildArgs(serial, { control = true, screenOff = false, record = null, title = null, wifi = false } = {}) {
  const args = ['-s', serial, '--stay-awake', '--window-title', title || `MVR · ${serial}`];
  if (wifi) args.push('--video-bit-rate=4M', '--max-size=1280'); // menos ancho de banda: más fluido por Wi-Fi
  if (!control) args.push('--no-control');
  if (control && screenOff) args.push('--turn-screen-off');
  if (record) args.push('--record', record);
  return args;
}

/** Explica en castellano los fallos típicos de scrcpy. */
function explain(text) {
  const t = String(text || '');
  if (/unauthorized/i.test(t)) return 'El móvil no ha autorizado este PC (depuración USB). Hay que aceptar el aviso en la pantalla del móvil.';
  if (/device .* not found|no devices|offline/i.test(t)) return 'No se encuentra el móvil por ADB. Revisa el cable y que la depuración USB esté activa.';
  if (/ENOENT|No se encontró/i.test(t)) return 'No se encontró scrcpy en la instalación.';
  if (/Could not open video stream|encoder|MediaCodec/i.test(t)) return 'El móvil no ha podido iniciar la captura de vídeo. Prueba de nuevo o reinicia el móvil.';
  const last = t.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
  return last || 'scrcpy se cerró sin dar motivo.';
}

/** Abre la ventana del espejo. Resuelve cuando arranca bien; rechaza si se cierra enseguida. */
function start(serial, opts = {}, onExit = () => {}) {
  if (running.has(serial)) return Promise.resolve('running');
  if (opts.record) fs.mkdirSync(path.dirname(opts.record), { recursive: true });
  const child = spawn(tools.resolveTool('scrcpy'), buildArgs(serial, opts), {
    windowsHide: false,
    env: { ...process.env, ADB: tools.resolveTool('adb') },
  });
  running.set(serial, child);
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-4000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve('started'); }, 3000);
    child.on('error', (e) => { running.delete(serial); if (!settled) { settled = true; clearTimeout(timer); reject(new Error(explain(e.message))); } });
    child.on('exit', (code) => {
      running.delete(serial);
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(explain(log))); return; }
      onExit({ serial, code, record: opts.record || null });
    });
  });
}

function stop(serial) {
  const c = running.get(serial);
  if (!c) return false;
  c.kill();
  running.delete(serial);
  return true;
}

const isRunning = (serial) => running.has(serial);

/**
 * Introduce el PIN o la contraseña que da el cliente (con su permiso), como si se tecleara en el móvil.
 * Android oculta la pantalla de bloqueo en las capturas (sale negra en el PC), pero sí acepta teclas.
 * No se guarda ni se registra el PIN.
 */
const PIN_RE = /^[\x21-\x7e]{1,64}$/;
async function enterPin(serial, pin) {
  if (!PIN_RE.test(String(pin || ''))) throw new Error('Escribe el PIN o la contraseña del cliente (letras, números o símbolos, sin espacios)');
  const sh = (cmd) => tools.run('adb', ['-s', serial, 'shell', cmd], { timeout: 15000 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sh('input keyevent KEYCODE_WAKEUP');
    await wait(400);
    const m = String((await sh('wm size')).stdout).match(/(\d+)x(\d+)\s*$/m);
    const [w, h] = m ? [Number(m[1]), Number(m[2])] : [1080, 2340];
    await sh(`input swipe ${Math.round(w / 2)} ${Math.round(h * 0.85)} ${Math.round(w / 2)} ${Math.round(h * 0.25)} 250`);
    await wait(700);
    await sh(`input text ${tools.shq(String(pin))}`);
    await sh('input keyevent KEYCODE_ENTER');
  } catch {
    // Sin detalles: el mensaje original incluiría el PIN.
    throw new Error('No se pudo enviar el PIN al móvil. Comprueba la conexión.');
  }
  return true;
}

module.exports = { buildArgs, explain, start, stop, isRunning, enterPin };
