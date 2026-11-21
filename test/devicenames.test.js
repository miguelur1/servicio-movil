'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/main/devicenames');

// Extracto real del formato de supported_devices.csv de Google Play (columnas: marca, nombre, codename, modelo).
const CSV = `Retail Branding,Marketing Name,Device,Model
"samsung","Galaxy S10","beyond1","SM-G973F"
"samsung","Galaxy S24 Ultra","e3q","SM-S928B"
"Xiaomi","Redmi Note 11 Pro 5G","veux","2201116SG"
"Xiaomi","Redmi Note 5 Pro","whyred","Redmi Note 5 Pro"
"Google","Pixel 8","shiba","Pixel 8"
"Fabricante, S.A.","Modelo ""raro""","raro1","R-1"
`;
const db = N.buildDb(CSV);

test('Android: nombre comercial desde la lista oficial de Google (Samsung por código de modelo)', () => {
  assert.equal(N.androidMarketName({ 'ro.product.model': 'SM-G973F', 'ro.product.manufacturer': 'samsung' }, db).name, 'Samsung Galaxy S10');
  assert.equal(N.androidMarketName({ 'ro.product.model': 'SM-S928B' }, db).name, 'Samsung Galaxy S24 Ultra');
});

test('Android: el modelo con guion bajo de «adb devices -l» también se encuentra', () => {
  assert.equal(N.androidMarketName({ 'ro.product.model': 'SM G973F' }, db).name, 'Samsung Galaxy S10');
  assert.equal(N.androidMarketName({ 'ro.product.model': 'SM_G973F' }, db).name, 'Samsung Galaxy S10');
});

test('Android: Xiaomi por código numérico y por codename', () => {
  assert.equal(N.androidMarketName({ 'ro.product.model': '2201116SG', 'ro.product.manufacturer': 'Xiaomi' }, db).name, 'Xiaomi Redmi Note 11 Pro 5G');
  assert.equal(N.androidMarketName({ 'ro.product.model': 'desconocido', 'ro.product.device': 'veux' }, db).name, 'Xiaomi Redmi Note 11 Pro 5G');
});

test('Android: la propiedad de nombre comercial del fabricante tiene prioridad', () => {
  const r = N.androidMarketName({ 'ro.product.model': '23124RA7EO', 'ro.product.manufacturer': 'Xiaomi', 'ro.product.marketname': 'Redmi Note 13 Pro 5G' }, db);
  assert.deepEqual(r, { name: 'Xiaomi Redmi Note 13 Pro 5G', source: 'prop' });
  // Pixel: el modelo ya es el nombre; no se duplica la marca.
  assert.equal(N.androidMarketName({ 'ro.product.model': 'Pixel 8', 'ro.product.manufacturer': 'Google' }, db).name, 'Google Pixel 8');
  // Una propiedad que solo repite el código no cuenta como nombre comercial.
  assert.equal(N.androidMarketName({ 'ro.product.model': 'SM-G973F', 'ro.product.manufacturer': 'samsung', 'ro.product.marketname': 'SM-G973F' }, db).source, 'google');
});

test('Android: sin datos cae a fabricante + modelo', () => {
  assert.deepEqual(N.androidMarketName({ 'ro.product.model': 'X100', 'ro.product.manufacturer': 'acme' }, db), { name: 'Acme X100', source: 'model' });
  assert.deepEqual(N.androidMarketName({ 'ro.product.model': 'X100' }, null), { name: 'X100', source: 'model' });
});

test('CSV: comillas dobles y comas dentro de los campos', () => {
  assert.deepEqual(db.m.r1, ['Fabricante, S.A.', 'Modelo "raro"']);
});

test('iPhone: identificador → nombre comercial', () => {
  assert.equal(N.iosMarketName('iPhone14,5'), 'iPhone 13');
  assert.equal(N.iosMarketName('iPhone12,8'), 'iPhone SE (2.ª gen.)');
  assert.equal(N.iosMarketName('iPhone17,1'), 'iPhone 16 Pro');
  assert.equal(N.iosMarketName('iPad13,18'), 'iPad (iPad13,18)');
  assert.equal(N.iosMarketName(undefined), null);
});
