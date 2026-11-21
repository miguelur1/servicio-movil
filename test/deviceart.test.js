'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/main/deviceart');

test('silueta según el modelo de iPhone', () => {
  const k = (m) => A.frameKind({ platform: 'ios', model: m });
  assert.equal(k('iPhone8,1'), 'iphone-home');     // 6s
  assert.equal(k('iPhone14,6'), 'iphone-home');    // SE 3
  assert.equal(k('iPhone10,3'), 'iphone-notch');   // X
  assert.equal(k('iPhone14,5'), 'iphone-notch');   // 13
  assert.equal(k('iPhone15,2'), 'iphone-island');  // 14 Pro
  assert.equal(k('iPhone17,5'), 'iphone-notch');   // 16e
  assert.equal(k('iPhone18,4'), 'iphone-island');  // Air
  assert.equal(k('iPad13,18'), 'ipad');
  assert.equal(A.frameKind({ platform: 'android', model: 'Pixel 8' }), 'pixel');
  assert.equal(A.frameKind({ platform: 'android', model: 'SM-G973F', marketName: 'Samsung Galaxy S10' }), 'android');
});

test('foto propia por modelo: guardar, leer, sustituir y quitar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  const png = path.join(dir, 'f.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000', 'hex'));
  assert.equal(A.getPhoto(dir, 'Xiaomi Redmi Note 13 Pro+ 5G'), null);
  const url = A.setPhoto(dir, 'Xiaomi Redmi Note 13 Pro+ 5G', png);
  assert.match(url, /^data:image\/png;base64,/);
  assert.ok(fs.existsSync(path.join(dir, 'xiaomi-redmi-note-13-pro-5g.png')));
  const jpg = path.join(dir, 'g.jpg'); fs.writeFileSync(jpg, 'x');
  assert.match(A.setPhoto(dir, 'Xiaomi Redmi Note 13 Pro+ 5G', jpg), /^data:image\/jpeg/);
  assert.ok(!fs.existsSync(path.join(dir, 'xiaomi-redmi-note-13-pro-5g.png')), 'la foto anterior se sustituye');
  A.removePhoto(dir, 'Xiaomi Redmi Note 13 Pro+ 5G');
  assert.equal(A.getPhoto(dir, 'Xiaomi Redmi Note 13 Pro+ 5G'), null);
  assert.throws(() => A.setPhoto(dir, 'X', path.join(dir, 'f.gif')), /PNG, JPG o WEBP/);
  assert.equal(A.photoKey('Teléfono ñ / ../x'), 'telefono-n-x');
});
