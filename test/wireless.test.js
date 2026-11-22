'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const w = require('../src/main/wireless');
const mirror = require('../src/main/mirror');

test('normAddress e isWifiSerial', () => {
  assert.strictEqual(w.normAddress('192.168.1.40'), '192.168.1.40:5555');
  assert.strictEqual(w.normAddress(' 192.168.1.40:37123 '), '192.168.1.40:37123');
  assert.throws(() => w.normAddress('-s x'), /no válida/);
  assert.throws(() => w.normAddress('1.2.3.4:99999'), /Puerto/);
  assert.ok(w.isWifiSerial('192.168.1.40:5555'));
  assert.ok(w.isWifiSerial('adb-R58M-abc._adb-tls-connect._tcp'));
  assert.ok(!w.isWifiSerial('R58M12ABCDE'));
});

test('parseWlanIp', () => {
  assert.strictEqual(w.parseWlanIp('30: wlan0    inet 192.168.1.40/24 brd 192.168.1.255 scope global wlan0'), '192.168.1.40');
  assert.strictEqual(w.parseWlanIp('1: lo    inet 127.0.0.1/8 scope host lo'), null);
});

test('enableTcpip: pasa de USB a Wi-Fi', async () => {
  assert.deepStrictEqual(await w.enableTcpip('R58M'), { address: '192.168.1.40:5555' });
  assert.match(fs.readFileSync(process.env.FAKE_LOG, 'utf8'), /-s R58M tcpip 5555\nconnect 192\.168\.1\.40:5555/);
  process.env.FAKE_NO_WIFI = '1';
  try { await assert.rejects(w.enableTcpip('R58M'), /no está conectado a ninguna Wi-Fi/); } finally { delete process.env.FAKE_NO_WIFI; }
});

test('connect, pair y disconnect', async () => {
  await assert.rejects(w.connect('10.9.9.9'), /rechazó/);
  assert.strictEqual(await w.pair('192.168.1.40:41234', '123456'), true);
  await assert.rejects(w.pair('192.168.1.40:41234', '000000'), /Wrong password/);
  await assert.rejects(w.pair('192.168.1.40:41234', '12'), /6 cifras/);
  assert.strictEqual(await w.disconnect('192.168.1.40'), true);
});

test('el espejo por Wi-Fi baja la calidad para ir fluido', () => {
  assert.ok(mirror.buildArgs('192.168.1.40:5555', { wifi: true }).includes('--max-size=1280'));
});
