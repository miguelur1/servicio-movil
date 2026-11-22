'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const mirror = require('../src/main/mirror');

test('buildArgs: opciones del espejo', () => {
  assert.deepStrictEqual(mirror.buildArgs('S1'), ['-s', 'S1', '--stay-awake', '--window-title', 'MVR · S1']);
  assert.deepStrictEqual(mirror.buildArgs('S1', { control: false, screenOff: true, record: 'v.mp4', title: 'Pixel' }), ['-s', 'S1', '--stay-awake', '--window-title', 'Pixel', '--no-control', '--record', 'v.mp4']);
  assert.ok(mirror.buildArgs('S1', { screenOff: true }).includes('--turn-screen-off'));
});

test('explain: mensajes en castellano', () => {
  assert.match(mirror.explain('ERROR: Device is unauthorized'), /no ha autorizado/);
  assert.match(mirror.explain('adb: device \'X\' not found'), /No se encuentra/);
});

test('start: falla enseguida con el motivo explicado', async () => {
  process.env.FAKE_SCRCPY_FAIL = '1';
  try { await assert.rejects(mirror.start('S2'), /no ha autorizado/); } finally { delete process.env.FAKE_SCRCPY_FAIL; }
  assert.strictEqual(mirror.isRunning('S2'), false);
});

test('start: arranca, usa nuestro adb y se puede cerrar', async () => {
  let exited = null;
  assert.strictEqual(await mirror.start('S3', {}, (e) => { exited = e; }), 'started');
  assert.strictEqual(await mirror.start('S3'), 'running');
  assert.match(fs.readFileSync(process.env.FAKE_LOG, 'utf8'), /scrcpy ADB=adb -s S3/);
  assert.strictEqual(mirror.stop('S3'), true);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(mirror.isRunning('S3'), false);
  assert.ok(exited && exited.serial === 'S3');
});
