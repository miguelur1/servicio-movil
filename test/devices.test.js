'use strict';
// Prueba los módulos android/ios de extremo a extremo con binarios falsos en el PATH.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skip = process.platform === 'win32' ? 'los binarios falsos son scripts sh' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const android = require('../src/main/android');
const ios = require('../src/main/ios');
const calls = () => fs.readFileSync(process.env.FAKE_LOG, 'utf8');

test('android.listDevices combina adb y fastboot', { skip }, async () => {
  const r = await android.listDevices();
  assert.equal(r.error, null);
  assert.deepEqual(r.devices.map((d) => [d.serial, d.state]), [['R58M12ABCDE', 'device'], ['FB123456', 'fastboot']]);
});

test('android.getInfo', { skip }, async () => {
  const i = await android.getInfo('R58M12ABCDE');
  assert.equal(i.manufacturer, 'samsung');
  assert.equal(i.model, 'SM-G973F');
  assert.equal(i.androidVersion, '12');
  assert.equal(i.bootloaderLocked, true);
  assert.equal(i.battery.level, 64);
  assert.equal(i.battery.status, 'Descargando');
  assert.equal(i.storage.totalBytes, 1000 * 1024);
});

test('android.screenshot guarda un PNG', { skip }, async () => {
  const f = await android.screenshot('R58M12ABCDE', tmp);
  assert.ok(fs.readFileSync(f).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
});

test('android.reboot valida el modo y usa el comando correcto', { skip }, async () => {
  await android.reboot('R58M12ABCDE', 'recovery');
  await android.reboot('FB123456', 'bootloader', true);
  await assert.rejects(android.reboot('R58M12ABCDE', 'edl'), /no válido/);
  assert.match(calls(), /-s R58M12ABCDE reboot recovery/);
  assert.match(calls(), /fastboot -s FB123456 reboot-bootloader/);
});

test('android.installApk exige un .apk existente', { skip }, async () => {
  await assert.rejects(android.installApk('R58M12ABCDE', path.join(tmp, 'no.apk')), /\.apk/);
  const apk = path.join(tmp, 'app.apk'); fs.writeFileSync(apk, 'x');
  assert.match(await android.installApk('R58M12ABCDE', apk), /Success/);
});

test('android.logcatDump limita el número de líneas', { skip }, async () => {
  assert.match(await android.logcatDump('R58M12ABCDE', 999999), /hola/);
  assert.match(calls(), /logcat -d -t 20000/);
});

test('ios.listDevices y getInfo', { skip }, async () => {
  const r = await ios.listDevices();
  assert.deepEqual(r.devices, [{ platform: 'ios', serial: '00008110-001A2B3C4D5E801E', state: 'device', model: 'iPhone de prueba', marketName: 'iPhone 13' }]);
  const i = await ios.getInfo('00008110-001A2B3C4D5E801E');
  assert.equal(i.iosVersion, '17.4.1');
  assert.equal(i.marketName, 'iPhone 13');
  assert.equal(i.battery.level, 91);
  assert.equal(i.battery.status, 'Cargando');
  assert.deepEqual(i.storage, { totalBytes: 100000, freeBytes: 25000, usedBytes: 75000 });
});

test('mensaje claro si falta la herramienta', { skip }, async () => {
  const tools = require('../src/main/tools');
  await assert.rejects(tools.run('herramienta_inexistente', []), /No se encontró/);
});
