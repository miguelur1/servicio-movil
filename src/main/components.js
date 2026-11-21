'use strict';
// Diagnóstico por piezas: lee el estado de cada componente (solo lectura) y ofrece pruebas manuales en Android.
const tools = require('./tools');
const P = require('./parsers');
const logs = require('./loganalysis');

const item = (id, name, status, detail) => ({ id, name, status, detail });

// ── Android ──────────────────────────────────────────────────────────────────
function parseFeatures(text) {
  return new Set(String(text || '').split(/\r?\n/).map((l) => l.replace(/^feature:/, '').trim()).filter(Boolean));
}

function parseSensors(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/^\s*0x[0-9a-f]+\)\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|[^\n]*?type:\s*android\.sensor\.([\w.]+)/gim)) {
    out.push({ name: m[1], vendor: m[2], type: m[3] });
  }
  return out;
}

function parseCameras(text) {
  const t = String(text || '');
  const n = t.match(/Number of camera devices:\s*(\d+)/i);
  const facings = [...t.matchAll(/Facing:\s*(BACK|FRONT|EXTERNAL|Back|Front)/g)].map((m) => m[1].toUpperCase());
  return { count: n ? Number(n[1]) : facings.length, back: facings.filter((f) => f === 'BACK').length, front: facings.filter((f) => f === 'FRONT').length };
}

function parseTouch(text) {
  const devs = [];
  for (const m of String(text || '').matchAll(/^\s*-?\d+: ([^\n]+)\n(?:[^\n]*\n){0,8}?\s*Classes: ([^\n]+)/gm)) devs.push({ name: m[1].trim(), classes: m[2] });
  return devs.filter((d) => /TOUCH_MT|TOUCH\b/.test(d.classes));
}

const SENSOR_FEATURES = [
  ['android.hardware.sensor.accelerometer', 'accelerometer', 'acelerómetro'],
  ['android.hardware.sensor.gyroscope', 'gyroscope', 'giroscopio'],
  ['android.hardware.sensor.compass', 'magnetic_field', 'brújula'],
  ['android.hardware.sensor.proximity', 'proximity', 'proximidad'],
  ['android.hardware.sensor.light', 'light', 'luz ambiental'],
  ['android.hardware.sensor.barometer', 'pressure', 'barómetro'],
];

/** Construye la lista de piezas a partir de las salidas de adb (función pura, se prueba sin teléfono). */
function androidFromOutputs(o) {
  const f = parseFeatures(o.features);
  const has = (x) => f.has(x);
  const list = [];

  // Pantalla y táctil
  const size = (o.wmSize || '').match(/(?:Override|Physical) size:\s*(\d+x\d+)/);
  const dens = (o.wmDensity || '').match(/(?:Override|Physical) density:\s*(\d+)/);
  const hz = Math.max(0, ...[...String(o.display || '').matchAll(/(?:refreshRate|fps)[=: ]+([\d.]+)/g)].map((m) => Number(m[1])).filter((x) => x < 1000));
  list.push(item('display', 'Pantalla', size ? 'ok' : 'warn', size ? `${size[1]} px${dens ? ` · ${dens[1]} dpi` : ''}${hz ? ` · ${Math.round(hz)} Hz` : ''}` : 'No se pudo leer la resolución'));
  const touch = parseTouch(o.input);
  list.push(item('touch', 'Táctil', touch.length ? 'ok' : 'bad', touch.length ? `Controlador: ${touch.map((t) => t.name).join(', ')}. Usa la prueba táctil para buscar zonas muertas.` : 'No se detecta el controlador táctil'));

  // Cámaras
  if (has('android.hardware.camera.any') || has('android.hardware.camera')) {
    const c = parseCameras(o.camera);
    const wantFront = has('android.hardware.camera.front');
    const missing = (!c.back && has('android.hardware.camera')) || (wantFront && !c.front);
    list.push(item('camera', 'Cámaras', !c.count ? 'bad' : missing ? 'warn' : 'ok',
      c.count ? `${c.count} cámara${c.count === 1 ? '' : 's'} (${c.back} trasera${c.back === 1 ? '' : 's'}, ${c.front} frontal${c.front === 1 ? '' : 'es'})${missing ? ' · falta alguna que el teléfono declara' : ''}` : 'El sistema no detecta ninguna cámara'));
  }

  // Sensores
  const sensors = parseSensors(o.sensors);
  const types = new Set(sensors.map((s) => s.type));
  const expected = SENSOR_FEATURES.filter(([feat]) => has(feat));
  const missing = expected.filter(([, type]) => !types.has(type)).map(([, , label]) => label);
  const present = SENSOR_FEATURES.filter(([, type]) => types.has(type)).map(([, , label]) => label);
  list.push(item('sensors', 'Sensores', !sensors.length ? 'bad' : missing.length ? 'bad' : 'ok',
    !sensors.length ? 'No se ha podido leer ningún sensor' : missing.length ? `No responde: ${missing.join(', ')}. Funcionan: ${present.join(', ') || '—'}` : `${present.join(', ')} (${sensors.length} en total)`));

  // Huella
  if (has('android.hardware.fingerprint')) {
    const fp = String(o.fingerprint || '');
    const broken = !fp.trim() || /Can't find service|not found|HAL.*(fail|error|dead)/i.test(fp);
    const enrolled = [...fp.matchAll(/"count"\s*:\s*(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    list.push(item('fingerprint', 'Lector de huellas', broken ? 'warn' : 'ok', broken ? 'El servicio de huellas no responde' : `Sensor activo · ${enrolled} huella${enrolled === 1 ? '' : 's'} registrada${enrolled === 1 ? '' : 's'}`));
  }

  // Wi-Fi y Bluetooth
  if (has('android.hardware.wifi')) {
    const w = String(o.wifi || '');
    const st = w.match(/Wi-Fi is (enabled|disabled)/i);
    const rssi = w.match(/RSSI:\s*(-\d+)/);
    list.push(item('wifi', 'Wi-Fi', !w.trim() ? 'bad' : st && /enabled/i.test(st[1]) ? 'ok' : 'warn',
      !w.trim() ? 'No responde el servicio Wi-Fi' : st && /enabled/i.test(st[1]) ? `Encendido${rssi && rssi[1] !== '-127' ? ` · señal ${rssi[1]} dBm` : ''}` : 'Apagado: actívalo en el teléfono para probarlo'));
  }
  if (has('android.hardware.bluetooth')) {
    const b = String(o.bluetooth || '');
    const on = /enabled:\s*true|state:\s*ON\b/i.test(b);
    list.push(item('bluetooth', 'Bluetooth', !b.trim() ? 'bad' : on ? 'ok' : 'warn', !b.trim() ? 'No responde el servicio Bluetooth' : on ? 'Encendido' : 'Apagado: actívalo en el teléfono para probarlo'));
  }
  if (has('android.hardware.nfc')) {
    const n = String(o.nfc || '').match(/mState=(\w+)/);
    list.push(item('nfc', 'NFC', n ? (/on/i.test(n[1]) ? 'ok' : 'warn') : 'warn', n ? (/on/i.test(n[1]) ? 'Encendido' : 'Apagado') : 'No se pudo leer'));
  }

  // SIM y red móvil
  if (has('android.hardware.telephony')) {
    const p = P.parseGetprop(o.radioProps || '');
    const baseband = (p['gsm.version.baseband'] || '').split(',')[0].trim();
    const sim = (p['gsm.sim.state'] || '').split(',')[0].trim().toUpperCase();
    const reg = String(o.telephony || '').match(/mVoiceRegState=\d\((\w+)\)/) || String(o.telephony || '').match(/mServiceState=\d\((\w+)\)/);
    const net = (p['gsm.network.type'] || '').split(',')[0];
    const op = (p['gsm.operator.alpha'] || '').split(',')[0];
    list.push(item('modem', 'Módem (baseband)', baseband ? 'ok' : 'bad', baseband ? baseband : 'Sin versión de baseband: el módem no arranca (sin cobertura, «IMEI desconocido»). Suele ser placa o firmware.'));
    const simStatus = sim === 'READY' || sim === 'LOADED' ? (reg && reg[1] !== 'IN_SERVICE' ? 'warn' : 'ok') : sim === 'ABSENT' ? 'warn' : sim ? 'warn' : 'warn';
    const SIMTXT = { ABSENT: 'Sin SIM insertada', PIN_REQUIRED: 'SIM bloqueada con PIN', PUK_REQUIRED: 'SIM bloqueada con PUK', NETWORK_LOCKED: 'SIM bloqueada por operador', NOT_READY: 'SIM no preparada', CARD_IO_ERROR: 'Error leyendo la SIM' };
    list.push(item('sim', 'SIM y cobertura', sim === 'CARD_IO_ERROR' ? 'bad' : simStatus,
      sim === 'READY' || sim === 'LOADED' ? `SIM lista${op ? ` · ${op}` : ''}${net ? ` · ${net}` : ''}${reg ? ` · ${reg[1] === 'IN_SERVICE' ? 'con servicio' : 'sin servicio'}` : ''}` : (SIMTXT[sim] || (sim ? `Estado: ${sim}` : 'No se pudo leer la SIM'))));
  }

  if (has('android.hardware.location.gps')) list.push(item('gps', 'GPS', /gps/i.test(o.location || '') ? 'ok' : 'warn', /gps/i.test(o.location || '') ? 'Proveedor GPS presente' : 'No aparece el proveedor GPS'));

  // Audio, vibración: solo se comprueban a mano
  list.push(item('audio', 'Altavoz y micrófono', 'info', 'Prueba manual: llamada de prueba o grabadora. También el menú de pruebas del fabricante.'));
  list.push(item('vibrator', 'Vibración', 'info', 'Pulsa «Vibrar» para probarla.'));

  // Almacenamiento (latencia de escritura)
  const lat = String(o.diskstats || '').match(/Latency:\s*(\d+)ms/);
  if (lat) list.push(item('storage', 'Memoria interna', Number(lat[1]) > 100 ? 'bad' : Number(lat[1]) > 30 ? 'warn' : 'ok', `Latencia de escritura ${lat[1]} ms${Number(lat[1]) > 30 ? ' (lenta: puede estar desgastada o muy llena)' : ''}`));

  // Carga
  const b = String(o.battery || '');
  const usb = /USB powered:\s*true/i.test(b); const ac = /AC powered:\s*true/i.test(b); const wl = /Wireless powered:\s*true/i.test(b);
  const maxI = b.match(/Max charging current:\s*(\d+)/);
  list.push(item('charging', 'Conector de carga', usb || ac || wl ? 'ok' : 'warn',
    usb || ac || wl ? `Recibe corriente por ${ac ? 'cargador' : usb ? 'USB' : 'inalámbrica'}${maxI && Number(maxI[1]) > 0 ? ` · máx. ${(Number(maxI[1]) / 1e6).toFixed(1)} A` : ''}` : 'Conectado por datos pero no indica carga: revisa el conector o el cable'));
  return list;
}

async function androidComponents(serial) {
  const sh = (cmd, timeout = 20000) => tools.run('adb', ['-s', serial, 'shell', cmd], { timeout }).then((r) => r.stdout).catch(() => '');
  const keys = {
    features: 'pm list features', sensors: 'dumpsys sensorservice', camera: 'dumpsys media.camera', input: 'dumpsys input',
    wmSize: 'wm size', wmDensity: 'wm density', display: 'dumpsys display | grep -iE "refreshRate|fps" | head -50',
    fingerprint: 'dumpsys fingerprint', wifi: 'dumpsys wifi | head -80', bluetooth: 'dumpsys bluetooth_manager | head -40', nfc: 'dumpsys nfc | head -20',
    radioProps: 'getprop | grep -E "gsm\\.(version\\.baseband|sim\\.state|network\\.type|operator\\.alpha)"',
    telephony: 'dumpsys telephony.registry | grep -m 3 -E "mServiceState|mVoiceRegState"', location: 'dumpsys location | grep -i -m 5 gps',
    diskstats: 'dumpsys diskstats | head -5', battery: 'dumpsys battery',
  };
  const vals = await Promise.all(Object.values(keys).map((c) => sh(c)));
  return androidFromOutputs(Object.fromEntries(Object.keys(keys).map((k, i) => [k, vals[i]])));
}

/** Pruebas manuales en Android. Solo acciones de prueba; nada toca bloqueos ni cuentas. */
async function androidTest(serial, test, on) {
  const sh = (cmd) => tools.run('adb', ['-s', serial, 'shell', cmd], { timeout: 15000 }).then((r) => r.stdout);
  switch (test) {
    case 'vibrate':
      return sh('cmd vibrator_manager synced oneshot 800 2>/dev/null || cmd vibrator vibrate 800 2>/dev/null || cmd vibrator vibrate -f 800 mvr').then(() => true);
    case 'touch':
      return sh(`settings put system pointer_location ${on ? 1 : 0}; settings put system show_touches ${on ? 1 : 0}`).then(() => !!on);
    case 'camera':
      return sh('am start -a android.media.action.STILL_IMAGE_CAMERA').then(() => true);
    case 'selfie':
      return sh('am start -a android.media.action.STILL_IMAGE_CAMERA --ei android.intent.extras.CAMERA_FACING 1 --ei android.intent.extras.LENS_FACING_FRONT 1 --ez android.intent.extra.USE_FRONT_CAMERA true').then(() => true);
    case 'sound':
      return sh('am start -a android.settings.SOUND_SETTINGS').then(() => true);
    default: throw new Error('Prueba no válida');
  }
}

/** Menú de pruebas oficial del fabricante (se marca en el teléfono). */
function factoryMenu(manufacturer) {
  const m = String(manufacturer || '').toLowerCase();
  if (m.includes('samsung')) return '*#0*#';
  if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) return '*#*#6484#*#*';
  if (m.includes('motorola')) return '*#*#2486#*#*';
  if (m.includes('huawei') || m.includes('honor')) return '*#*#2846579#*#*';
  if (m.includes('oppo') || m.includes('realme') || m.includes('oneplus')) return '*#899#';
  return null;
}

// ── iPhone ───────────────────────────────────────────────────────────────────
function iosFromOutputs(info, panicsResult) {
  const list = [];
  const bb = info.BasebandVersion;
  const tel = info.TelephonyCapability !== 'false';
  if (tel) list.push(item('modem', 'Módem (baseband)', bb ? 'ok' : 'bad', bb ? `Versión ${bb}` : 'Sin versión de baseband: el módem no arranca (sin servicio). Suele ser placa.'));
  const sim = info.SIMStatus || '';
  const tray = info.SIMTrayStatus || '';
  if (tel) {
    list.push(item('sim', 'SIM', /Ready/i.test(sim) ? 'ok' : /NotInserted/i.test(sim) ? 'warn' : sim ? 'warn' : 'info',
      /Ready/i.test(sim) ? 'SIM lista' : /NotInserted/i.test(sim) ? (/Inserted/i.test(tray) && !/NotInserted/i.test(tray) ? 'Bandeja puesta pero no lee la SIM' : 'Sin SIM (o eSIM sin activar)') : sim ? `Estado: ${sim.replace(/^kCTSIMSupportSIMStatus/, '')}` : 'No informado'));
  }
  list.push(item('wifi', 'Wi-Fi', info.WiFiAddress ? 'ok' : 'bad', info.WiFiAddress ? 'Chip detectado' : 'No se detecta el chip Wi-Fi (Wi-Fi en gris)'));
  list.push(item('bluetooth', 'Bluetooth', info.BluetoothAddress ? 'ok' : 'bad', info.BluetoothAddress ? 'Chip detectado' : 'No se detecta el chip Bluetooth'));
  if ('ProximitySensorCalibration' in info) list.push(item('proximity', 'Sensor de proximidad', info.ProximitySensorCalibration ? 'ok' : 'warn', info.ProximitySensorCalibration ? 'Calibrado' : 'Sin calibración (pantalla o flex de proximidad cambiados)'));
  const panics = (panicsResult && panicsResult.panics) || [];
  const parts = {};
  for (const p of panics) if (p.part) parts[p.part] = (parts[p.part] || 0) + 1;
  const partList = Object.entries(parts).sort((a, b) => b[1] - a[1]);
  list.push(item('panics', 'Reinicios inesperados', !panics.length ? 'ok' : partList.length ? 'bad' : 'warn',
    !panics.length ? 'Ningún reinicio del sistema guardado' : `${panics.length} reinicio${panics.length === 1 ? '' : 's'}${partList.length ? ` · apunta a: ${partList.map(([p, n]) => `${p} (${n})`).join(', ')}` : ''}`));
  list.push(item('screen', 'Pantalla, táctil y Face ID / Touch ID', 'info', 'Prueba en el iPhone. Ajustes › General › Información › «Historial de piezas y servicio» muestra piezas no originales (iOS 15.2+).'));
  list.push(item('cameras', 'Cámaras, altavoz y micrófono', 'info', 'Prueba en el iPhone (cámara, grabadora, llamada).'));
  return list;
}

async function iosComponents(udid) {
  const [{ stdout }, reports] = await Promise.all([
    tools.run('ideviceinfo', ['-u', udid], { timeout: 20000 }),
    require('./ios').crashReports(udid).catch(() => []),
  ]);
  return iosFromOutputs(P.parseIdeviceinfo(stdout), logs.analyzeIosReports(reports));
}

module.exports = { androidComponents, androidFromOutputs, androidTest, factoryMenu, iosComponents, iosFromOutputs, parseSensors, parseCameras, parseTouch, parseFeatures };
