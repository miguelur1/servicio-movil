'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skip = process.platform === 'win32' ? 'los binarios falsos son scripts sh' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-apps-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const A = require('../src/main/apps');
const calls = () => fs.readFileSync(process.env.FAKE_LOG, 'utf8');

test('parsePmList: rutas con "=" y versionCode', () => {
  assert.deepEqual(A.parsePmList('package:/data/app/~~x==/com.a-1/base.apk=com.a versionCode:5\npackage:/system/app/B.apk=com.b\n'),
    [{ id: 'com.a', path: '/data/app/~~x==/com.a-1/base.apk', versionCode: 5 }, { id: 'com.b', path: '/system/app/B.apk', versionCode: null }]);
});

test('Android: lista de apps con estado activada/desactivada', { skip }, async () => {
  const l = await A.androidList('S');
  assert.deepEqual(l.map((a) => [a.id, a.versionCode, a.enabled]), [['com.ejemplo.app', 7, false], ['com.whatsapp', 241234, true]]);
  const s = await A.androidList('S', { system: true });
  assert.equal(s[0].id, 'com.google.android.youtube');
  assert.equal(s[0].system, true);
});

test('Android: desinstalar (usuario y sistema), desactivar, activar y recuperar', { skip }, async () => {
  assert.equal(await A.androidUninstall('S', 'com.whatsapp'), true);
  assert.match(calls(), /-s S uninstall com\.whatsapp/);
  await A.androidUninstall('S', 'com.google.android.youtube', { system: true });
  assert.match(calls(), /pm uninstall -k --user 0 com\.google\.android\.youtube/);
  assert.equal(await A.androidSetEnabled('S', 'com.whatsapp', false), false);
  assert.equal(await A.androidSetEnabled('S', 'com.whatsapp', true), true);
  assert.equal(await A.androidRestoreSystemApp('S', 'com.google.android.youtube'), true);
});

test('Android: rechaza identificadores que podrían inyectar comandos', async () => {
  await assert.rejects(A.androidUninstall('S', 'com.a; reboot'), /no válido/);
  await assert.rejects(A.androidSetEnabled('S', '$(rm -rf /)', false), /no válido/);
});

test('Android: copia de APK (incluye splits) e instalación', { skip }, async () => {
  const r = await A.androidBackupApk('S', 'com.ejemplo.app', tmp);
  assert.equal(r.files, 2);
  const a = path.join(tmp, 'a.apk'); const b = path.join(tmp, 'b.apk'); fs.writeFileSync(a, 'x'); fs.writeFileSync(b, 'x');
  assert.equal(await A.androidInstall('S', [a, b]), 2);
  assert.match(calls(), /install-multiple -r .*a\.apk .*b\.apk/);
  await assert.rejects(A.androidInstall('S', [path.join(tmp, 'x.txt')]), /\.apk/);
});

test('iPhone: lista de apps (sintaxis nueva) con comas en el nombre', { skip }, async () => {
  A.resetSyntax();
  const l = await A.iosList('UDID');
  assert.deepEqual(l.map((a) => [a.id, a.version, a.name]), [['com.ejemplo.taller', '1.0', 'Taller, mi app'], ['net.whatsapp.WhatsApp', '24.10.1', 'WhatsApp']]);
  assert.match(calls(), /ideviceinstaller -u UDID list --user/);
});

test('iPhone: sintaxis antigua de ideviceinstaller (-l / -U / -i)', { skip }, async () => {
  process.env.FAKE_II_OLD = '1'; A.resetSyntax();
  try {
    await A.iosList('UDID', { system: true });
    assert.match(calls(), /ideviceinstaller -u UDID -l -o list_system/);
    await A.iosUninstall('UDID', 'net.whatsapp.WhatsApp');
    assert.match(calls(), /ideviceinstaller -u UDID -U net\.whatsapp\.WhatsApp/);
  } finally { delete process.env.FAKE_II_OLD; A.resetSyntax(); }
});

test('iPhone: instalar .ipa y error claro si no está firmado para el dispositivo', { skip }, async () => {
  const ok = path.join(tmp, 'buena.ipa'); fs.writeFileSync(ok, 'x');
  assert.equal(await A.iosInstall('UDID', ok), true);
  const bad = path.join(tmp, 'mala.ipa'); fs.writeFileSync(bad, 'x');
  await assert.rejects(A.iosInstall('UDID', bad), /no está firmado para este iPhone/);
  await assert.rejects(A.iosUninstall('UDID', 'a b'), /no válido/);
});
