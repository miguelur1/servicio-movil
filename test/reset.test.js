'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const calls = () => (fs.existsSync(process.env.FAKE_LOG) ? fs.readFileSync(process.env.FAKE_LOG, 'utf8') : '');
const reset = require('../src/main/reset');

test('androidCheck: avisa de las cuentas de Google (FRP) y del bootloader', async () => {
  const r = await reset.androidCheck('R58M');
  assert.deepStrictEqual(r.googleAccounts, ['cliente@gmail.com']);
  assert.strictEqual(r.bootloaderUnlocked, false);
  assert.strictEqual(r.oemUnlockAllowed, true);
});

test('androidOpenResetScreen: abre la pantalla oficial y prueba alternativas', async () => {
  assert.strictEqual(await reset.androidOpenResetScreen('R58M'), 'reset');
  process.env.FAKE_NO_RESET_ACT = '1';
  try { assert.strictEqual(await reset.androidOpenResetScreen('R58M'), 'dashboard'); } finally { delete process.env.FAKE_NO_RESET_ACT; }
});

test('fastbootWipe: exige BORRAR y bootloader desbloqueado', async () => {
  await assert.rejects(reset.fastbootWipe('FB1', 'si'), /Escribe BORRAR/);
  process.env.FAKE_UNLOCKED = 'no';
  try { await assert.rejects(reset.fastbootWipe('FB1', 'BORRAR'), /bloqueado/); } finally { delete process.env.FAKE_UNLOCKED; }
  assert.ok(!/ -w/.test(calls()));
  assert.strictEqual(await reset.fastbootWipe('FB1', 'borrar'), true);
  assert.match(calls(), /fastboot -s FB1 -w\nfastboot -s FB1 reboot/);
});

test('iosEnterRecovery: exige confirmación', async () => {
  await assert.rejects(reset.iosEnterRecovery('0000811', ''), /BORRAR/);
  assert.strictEqual(await reset.iosEnterRecovery('0000811', 'BORRAR'), true);
  assert.match(calls(), /ideviceenterrecovery 0000811/);
});
