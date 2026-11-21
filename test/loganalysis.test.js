'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/main/loganalysis');

const LOGCAT = [
  '11-21 10:00:00.000 E/AndroidRuntime( 1234): FATAL EXCEPTION: main',
  '11-21 10:00:00.001 E/AndroidRuntime( 1234): Process: com.whatsapp, PID: 1234',
  '11-21 10:00:00.001 E/AndroidRuntime( 1234): Process: com.whatsapp, PID: 1234',
  '11-21 10:05:00.000 E/AndroidRuntime( 2234): Process: com.whatsapp, PID: 2234',
  '11-21 10:06:00.000 E/ActivityManager(  900): ANR in com.instagram.android',
  '11-21 10:07:00.000 F/libc    ( 3000): Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 3001 (RenderThread), pid 3000 (com.ejemplo)',
  '11-21 10:08:00.000 E/CameraService(  700): Camera 2: Error opening camera device: timeout',
  '11-21 10:08:01.000 I/CameraService(  700): Camera 2: connect called (no es error)',
  '11-21 10:09:00.000 W/UsbDeviceManager(  900): moisture detected on USB port',
  '11-21 10:10:00.000 E/kernel  (    0): EXT4-fs error (device dm-5): ext4_lookup:1700: inode corrupt',
  '11-21 10:11:00.000 I/Test    (    1): todo bien',
].join('\n');

test('analyzeAndroid: detecta fallos, agrupa apps y ordena por gravedad', () => {
  const a = L.analyzeAndroid(LOGCAT, { bootReason: 'reboot,userrequested' });
  const ids = a.findings.map((f) => f.id);
  assert.strictEqual(a.verdict, 'bad');
  assert.strictEqual(ids[0], 'storage_hw');
  for (const id of ['app_crash', 'anr', 'native_crash', 'camera', 'moisture']) assert.ok(ids.includes(id), id);
  const crash = a.findings.find((f) => f.id === 'app_crash');
  assert.deepStrictEqual(crash.apps, [{ name: 'com.whatsapp', count: 2 }]); // la línea repetida cuenta una vez
  assert.strictEqual(a.findings.find((f) => f.id === 'native_crash').apps[0].name, 'com.ejemplo');
  assert.strictEqual(a.findings.find((f) => f.id === 'camera').count, 1); // la línea I/ no cuenta
  assert.ok(!ids.includes('boot'));
  assert.match(a.summary, /graves/);
});

test('analyzeAndroid: registro limpio', () => {
  const a = L.analyzeAndroid('11-21 10:11:00.000 I/Test( 1): hola');
  assert.deepStrictEqual([a.verdict, a.findings.length], ['ok', 0]);
});

test('analyzeAndroid: motivo de arranque e historial de dropbox', () => {
  const dropbox = 'Drop box contents: 5 entries\n2026-11-20 09:00:00 SYSTEM_LAST_KMSG (compressed text, 100 bytes)\n2026-11-20 10:00:00 SYSTEM_LAST_KMSG (compressed text, 100 bytes)\n2026-11-21 10:00:00 SYSTEM_LAST_KMSG (compressed text, 100 bytes)\n2026-11-21 11:00:00 data_app_crash (text, 50 bytes)\n';
  const a = L.analyzeAndroid('', { bootReason: 'kernel_panic', dropbox });
  assert.strictEqual(a.findings[0].sev, 'alta');
  assert.ok(a.findings.some((f) => f.id === 'boot'));
  assert.ok(a.findings.some((f) => f.id === 'hist_SYSTEM_LAST_KMSG' && f.count === 3 && f.sev === 'alta'));
  assert.deepStrictEqual(a.history.map((h) => [h.tag, h.count]), [['SYSTEM_LAST_KMSG', 3], ['data_app_crash', 1]]);
});

test('bootReason', () => {
  assert.strictEqual(L.bootReason('shutdown,thermal').sev, 'media');
  assert.strictEqual(L.bootReason('reboot').sev, 'ok');
  assert.strictEqual(L.bootReason(''), null);
});

test('analyzeIos: panics con pista de pieza, apps y syslog', () => {
  const reports = [
    { name: 'panic-full-2026-11-20-101010.000.ips', text: '{"bug_type":"210"}\n{"panicString":"panic(cpu 0 caller 0x1): Missing sensor(s): mic1 mic2\\n"}' },
    { name: 'panic-full-2026-11-21-101010.000.ips', text: '{"panicString":"Missing sensor(s): mic1"}' },
    { name: 'WhatsApp-2026-11-21-101010.ips', text: '' },
    { name: 'JetsamEvent-2026-11-21-101010.ips', text: '' },
  ];
  const syslog = 'Nov 21 10:00:00 iPhone thermalmonitord[100] <Notice>: thermal pressure level heavy\nNov 21 10:00:01 iPhone kernel[0] <Notice>: normal';
  const a = L.analyzeIos(syslog, reports);
  assert.strictEqual(a.verdict, 'bad');
  const p = a.findings.find((f) => f.id === 'panic');
  assert.strictEqual(p.count, 2);
  assert.match(p.explain, /flex de carga/);
  assert.ok(a.findings.some((f) => f.id === 'thermal'));
  assert.deepStrictEqual(a.findings.find((f) => f.id === 'app_crash_reports').apps, [{ name: 'WhatsApp', count: 1 }]);
  assert.strictEqual(a.reports, 4);
});
