'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skip = process.platform === 'win32' ? 'los binarios falsos son scripts sh' : false;
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
const D = require('../src/main/diagnostics');
const { parsePlist } = require('../src/main/plist');

test('plist XML: diccionarios anidados, tipos y entidades', () => {
  const o = parsePlist('<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict><key>a</key><integer>3</integer><key>b</key><dict><key>c</key><string>x &amp; y</string></dict><key>t</key><true/><key>arr</key><array><integer>1</integer><string>dos</string></array><key>e</key><array/><key>r</key><real>1.5</real></dict></plist>');
  assert.deepEqual(o, { a: 3, b: { c: 'x & y' }, t: true, arr: [1, 'dos'], e: [], r: 1.5 });
});

test('iPhone: salud de batería desde AppleSmartBattery', { skip }, async () => {
  const b = await D.iosBattery('UDID');
  assert.equal(b.cycleCount, 631);
  assert.equal(b.designCapacityMah, 3227);
  assert.equal(b.fullChargeCapacityMah, 2685);
  assert.equal(b.healthPercent, 83.2);
  assert.equal(b.temperatureC, 29.5);
  assert.equal(b.serial, 'F5D1234&X');
  assert.equal(b.isCharging, false);
  assert.equal(D.batteryVerdict(b).level, 'warn');
});

test('iPhone: prefiere MaximumCapacityPercent (lo que muestra Ajustes) si existe', () => {
  const b = D.iosBatteryFromIoreg({ IORegistry: { CycleCount: 10, DesignCapacity: 3000, AppleRawMaxCapacity: 2900, BatteryData: { MaximumCapacityPercent: 100 } } });
  assert.equal(b.healthPercent, 100);
});

test('iPhone antiguo: recurre a GasGauge', { skip }, async () => {
  process.env.FAKE_OLD_IOS = '1';
  try {
    const b = await D.iosBattery('UDID');
    assert.equal(b.source, 'GasGauge');
    assert.equal(b.cycleCount, 100);
    assert.equal(b.healthPercent, 93.9);
  } finally { delete process.env.FAKE_OLD_IOS; }
});

test('Android: salud desde /sys (µAh → mAh) y datos de dumpsys', { skip }, async () => {
  const b = await D.androidBattery('R58M12ABCDE');
  assert.equal(b.cycleCount, 412);
  assert.equal(b.designCapacityMah, 4614);
  assert.equal(b.fullChargeCapacityMah, 3891);
  assert.equal(b.healthPercent, 84.3);
  assert.equal(b.currentCapacityPercent, 64);
  assert.equal(b.source, '/sys/class/power_supply');
});

test('Android sin /sys accesible: no inventa la salud', { skip }, async () => {
  process.env.FAKE_NO_SYS = '1';
  try {
    const b = await D.androidBattery('R58M12ABCDE');
    assert.equal(b.healthPercent, null);
    assert.equal(b.source, 'dumpsys battery');
    assert.equal(D.batteryVerdict(b).level, 'unknown');
  } finally { delete process.env.FAKE_NO_SYS; }
});

test('Android: valores ya en mAh y state_of_health del fabricante', () => {
  const b = D.androidBatteryFromSys('charge_full=4100\ncharge_full_design=5000\nstate_of_health=88\ncycle_count=-1\n', 'level: 50\nscale: 100\n');
  assert.equal(b.fullChargeCapacityMah, 4100);
  assert.equal(b.healthPercent, 88);
  assert.equal(b.cycleCount, null);
});

test('veredicto de batería por umbrales', () => {
  assert.equal(D.batteryVerdict({ healthPercent: 92 }).level, 'ok');
  assert.equal(D.batteryVerdict({ healthPercent: 79.9 }).level, 'bad');
});

test('informe HTML: datos, veredicto y escape de caracteres', () => {
  const html = D.reportHtml({ platform: 'ios', name: 'iPhone de <Ana>', model: 'iPhone14,5', iosVersion: '18.1', serial: 'U', storage: { totalBytes: 128e9, freeBytes: 28e9 } },
    { healthPercent: 78, cycleCount: 900, designCapacityMah: 3227 });
  assert.match(html, /iPhone de &lt;Ana&gt;/);
  assert.match(html, /78 %/);
  assert.match(html, /class="v bad"/);
  assert.match(html, /Firma del cliente/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inf-'));
  const f = D.saveReport(dir, { platform: 'android', model: 'Pixel 8', serial: 'S' }, null);
  assert.match(path.basename(f), /^informe-Pixel_8-/);
});

test('reportHtml: incluye piezas y análisis del registro, escapando el texto', () => {
  const d = require('../src/main/diagnostics');
  const html = d.reportHtml({ platform: 'android', marketName: 'Pixel 8', model: 'Pixel 8' }, { healthPercent: 90 }, {
    components: [{ id: 'touch', name: 'Táctil', status: 'bad', detail: 'No se detecta <b>' }],
    analysis: { verdict: 'warn', summary: 'Hay 1 tipo de fallo a revisar.', findings: [{ sev: 'media', title: 'Apps que se cierran solas', count: 2, explain: 'x', fix: 'y' }] },
  });
  assert.match(html, /Estado de las piezas/);
  assert.match(html, /<span class="st bad">Fallo<\/span> · No se detecta &lt;b&gt;/);
  assert.match(html, /Análisis del registro del sistema/);
  assert.match(html, /Media: Apps que se cierran solas<\/b> \(2 veces\)/);
  assert.doesNotMatch(d.reportHtml({ platform: 'ios' }, null), /Estado de las piezas/);
  assert.match(d.reportName({ marketName: 'Google Pixel 8' }, 'pdf'), /^informe-Google_Pixel_8-.*\.pdf$/);
});
