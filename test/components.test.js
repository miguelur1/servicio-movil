'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/main/components');

const OUT = {
  features: 'feature:android.hardware.camera\nfeature:android.hardware.camera.any\nfeature:android.hardware.camera.front\nfeature:android.hardware.sensor.proximity\nfeature:android.hardware.sensor.accelerometer\nfeature:android.hardware.sensor.gyroscope\nfeature:android.hardware.wifi\nfeature:android.hardware.bluetooth\nfeature:android.hardware.telephony\nfeature:android.hardware.fingerprint\nfeature:android.hardware.location.gps',
  sensors: 'Sensor List:\n0x0000000b) LSM6DSO Accelerometer | STMicro | ver: 1 | type: android.sensor.accelerometer(1) | perm: n/a\n0x0000000c) LSM6DSO Gyroscope | STMicro | ver: 1 | type: android.sensor.gyroscope(4) | perm: n/a\n',
  camera: 'Number of camera devices: 3\n  Facing: BACK\n  Facing: BACK\n  Facing: FRONT\n',
  input: 'Input Devices:\n  3: fts_ts\n    Generation: 2\n    Classes: TOUCH | TOUCH_MT\n  4: gpio-keys\n    Classes: KEYBOARD\n',
  wmSize: 'Physical size: 1080x2400', wmDensity: 'Physical density: 440', display: 'refreshRate 120.0\nrefreshRate 60.0',
  fingerprint: '{"service":"Fingerprint Manager","prints":[{"id":0,"count":2}]}',
  wifi: 'Wi-Fi is enabled\nmWifiInfo SSID: x, RSSI: -58', bluetooth: 'enabled: false\nstate: OFF',
  radioProps: '[gsm.version.baseband]: []\n[gsm.sim.state]: [READY]\n[gsm.operator.alpha]: [Movistar]\n[gsm.network.type]: [LTE]',
  telephony: 'mServiceState=0(IN_SERVICE)', location: 'gps provider', diskstats: 'Latency: 4ms [512B Data Write]',
  battery: 'AC powered: false\nUSB powered: true\nMax charging current: 500000',
};

test('androidFromOutputs: estado de cada pieza', () => {
  const by = Object.fromEntries(C.androidFromOutputs(OUT).map((c) => [c.id, c]));
  assert.strictEqual(by.display.status, 'ok'); assert.match(by.display.detail, /1080x2400 px · 440 dpi · 120 Hz/);
  assert.strictEqual(by.touch.status, 'ok'); assert.match(by.touch.detail, /fts_ts/);
  assert.strictEqual(by.camera.status, 'ok'); assert.match(by.camera.detail, /3 cámaras \(2 traseras, 1 frontal\)/);
  assert.strictEqual(by.sensors.status, 'bad'); assert.match(by.sensors.detail, /No responde: proximidad/);
  assert.strictEqual(by.fingerprint.status, 'ok'); assert.match(by.fingerprint.detail, /2 huellas/);
  assert.strictEqual(by.wifi.status, 'ok'); assert.match(by.wifi.detail, /-58 dBm/);
  assert.strictEqual(by.bluetooth.status, 'warn');
  assert.strictEqual(by.modem.status, 'bad');
  assert.strictEqual(by.sim.status, 'ok'); assert.match(by.sim.detail, /Movistar · LTE · con servicio/);
  assert.strictEqual(by.storage.status, 'ok');
  assert.strictEqual(by.charging.status, 'ok'); assert.match(by.charging.detail, /USB · máx. 0.5 A/);
  assert.ok(!by.nfc, 'sin NFC declarado no se muestra');
});

test('androidFromOutputs: sin táctil ni cámaras', () => {
  const by = Object.fromEntries(C.androidFromOutputs({ ...OUT, input: '', camera: 'Number of camera devices: 0' }).map((c) => [c.id, c]));
  assert.strictEqual(by.touch.status, 'bad');
  assert.strictEqual(by.camera.status, 'bad');
});

test('iosFromOutputs', () => {
  const panics = { panics: [{ part: 'Micrófonos del flex de carga' }, { part: 'Micrófonos del flex de carga' }] };
  const by = Object.fromEntries(C.iosFromOutputs({ BasebandVersion: '5.00.00', SIMStatus: 'kCTSIMSupportSIMStatusReady', WiFiAddress: 'aa', BluetoothAddress: '' }, panics).map((c) => [c.id, c]));
  assert.strictEqual(by.modem.status, 'ok');
  assert.strictEqual(by.sim.status, 'ok');
  assert.strictEqual(by.wifi.status, 'ok');
  assert.strictEqual(by.bluetooth.status, 'bad');
  assert.strictEqual(by.panics.status, 'bad'); assert.match(by.panics.detail, /flex de carga \(2\)/);
  const none = Object.fromEntries(C.iosFromOutputs({ TelephonyCapability: 'false', WiFiAddress: 'a', BluetoothAddress: 'b' }, { panics: [] }).map((c) => [c.id, c]));
  assert.ok(!none.modem); assert.strictEqual(none.panics.status, 'ok');
});

test('factoryMenu', () => {
  assert.strictEqual(C.factoryMenu('samsung'), '*#0*#');
  assert.strictEqual(C.factoryMenu('Xiaomi'), '*#*#6484#*#*');
  assert.strictEqual(C.factoryMenu('Google'), null);
});
