'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/main/parsers');

test('parseAdbDevices: varios estados y atributos', () => {
  const out = `List of devices attached
R58M12ABCDE            device usb:1-1 product:beyond1lteeea model:SM_G973F device:beyond1 transport_id:3
emulator-5554          unauthorized transport_id:4
0123456789ABCDEF       recovery usb:1-2 product:sunfish model:Pixel_4a device:sunfish transport_id:5

`;
  const d = P.parseAdbDevices(out);
  assert.equal(d.length, 3);
  assert.deepEqual(d[0], { serial: 'R58M12ABCDE', state: 'device', usb: '1-1', product: 'beyond1lteeea', model: 'SM G973F', device: 'beyond1', transportId: '3' });
  assert.equal(d[1].state, 'unauthorized');
  assert.equal(d[2].model, 'Pixel 4a');
});

test('parseAdbDevices: ignora mensajes del daemon y salida vacía', () => {
  assert.deepEqual(P.parseAdbDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n'), []);
  assert.deepEqual(P.parseAdbDevices(''), []);
});

test('parseFastbootDevices', () => {
  assert.deepEqual(P.parseFastbootDevices('0A1B2C3D\tfastboot\n\n'), [{ serial: '0A1B2C3D', state: 'fastboot' }]);
});

test('parseGetprop con CRLF de Windows', () => {
  const p = P.parseGetprop('[ro.product.model]: [Pixel 7]\r\n[ro.build.version.release]: [14]\r\n[empty.prop]: []\r\nbasura\r\n');
  assert.equal(p['ro.product.model'], 'Pixel 7');
  assert.equal(p['ro.build.version.release'], '14');
  assert.equal(p['empty.prop'], '');
});

test('parseDumpsysBattery', () => {
  const b = P.parseDumpsysBattery(`Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  health: 2
  present: true
  level: 87
  scale: 100
  voltage: 4312
  temperature: 291
  technology: Li-ion
`);
  assert.equal(b.level, 87);
  assert.equal(b.status, 'Cargando');
  assert.equal(b.health, 'Buena');
  assert.equal(b.temperatureC, 29.1);
  assert.equal(b.voltageMv, 4312);
  assert.equal(b.usbPowered, true);
  assert.equal(b.technology, 'Li-ion');
});

test('parseDumpsysBattery con escala distinta de 100', () => {
  assert.equal(P.parseDumpsysBattery('level: 50\nscale: 200\n').level, 25);
});

test('parseDf (toybox y formato con nombre de partición largo)', () => {
  const r = P.parseDf(`Filesystem      1K-blocks     Used Available Use% Mounted on
/dev/block/dm-48 115310640 45678912  69500000  40% /data`);
  assert.deepEqual(r, { totalBytes: 115310640 * 1024, usedBytes: 45678912 * 1024, freeBytes: 69500000 * 1024 });
  assert.equal(P.parseDf('error: closed'), null);
});

test('parseIdeviceinfo ignora valores anidados', () => {
  const i = P.parseIdeviceinfo(`ActivationState: Activated
BuildVersion: 21E236
DeviceName: iPhone de Miguel
ProductType: iPhone14,5
ProductVersion: 17.4.1
SupportedDeviceFamilies:
 0: 1
SerialNumber: F2LXXXXXXX
`);
  assert.equal(i.DeviceName, 'iPhone de Miguel');
  assert.equal(i.ProductType, 'iPhone14,5');
  assert.equal(i.SupportedDeviceFamilies, undefined);
  assert.equal(i['0'], undefined);
});

test('parseIdeviceIds', () => {
  assert.deepEqual(P.parseIdeviceIds('00008110-001A2B3C4D5E801E\n00008030-000A (Network)\n'), ['00008110-001A2B3C4D5E801E', '00008030-000A']);
});

test('formatBytes', () => {
  assert.equal(P.formatBytes(0), '0 B');
  assert.equal(P.formatBytes(1536), '1.5 KB');
  assert.equal(P.formatBytes(128 * 1024 ** 3), '128.0 GB');
  assert.equal(P.formatBytes(null), '—');
});
