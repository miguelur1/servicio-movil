'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { elevatedPnputilArgs, installGoogleUsbDriver } = require('../src/main/drivers');

test('driver de Google: pnputil elevado con la ruta entre comillas (espacios y apóstrofos)', () => {
  const inf = "C:\\Program Files\\Servicio Móvil\\resources\\bin\\google-usb-driver\\android_winusb.inf";
  const args = elevatedPnputilArgs(inf);
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(args[3], /Start-Process -FilePath 'pnputil\.exe'/);
  assert.match(args[3], /-Verb RunAs -Wait -PassThru/);
  assert.ok(args[3].includes(`'"${inf}"'`), 'la ruta va entre comillas dobles dentro de una cadena de PowerShell');
  assert.match(args[3], /'\/add-driver'.*'\/install'/);
  const tricky = elevatedPnputilArgs("C:\\Users\\O'Neil\\x.inf")[3];
  assert.ok(tricky.includes("O''Neil"), 'escapa el apóstrofo para PowerShell');
});

test('driver de Google: fuera de Windows explica que no hace falta', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(installGoogleUsbDriver(), /solo hace falta en Windows/);
});
