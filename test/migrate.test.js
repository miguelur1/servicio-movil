'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skip = process.platform === 'win32' ? 'los binarios falsos son scripts sh' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-mig-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const M = require('../src/main/migrate');
const calls = () => fs.readFileSync(process.env.FAKE_LOG, 'utf8');
const UDID = '00008110-001A2B3C4D5E801E';

test('plan: combinaciones admitidas y la que Apple no permite', () => {
  assert.deepEqual(M.plan('android', 'android').items, ['photos', 'files', 'contacts', 'apps']);
  assert.deepEqual(M.plan('ios', 'android').items, ['photos', 'contacts']);
  assert.deepEqual(M.plan('ios', 'ios').items, ['full']);
  const no = M.plan('android', 'ios');
  assert.equal(no.ok, false);
  assert.match(no.reason, /Pasar a iOS/);
});

test('Android → Android: fotos, archivos, contactos y apps', { skip }, async () => {
  const seen = [];
  const r = await M.migrate({ platform: 'android', serial: 'ORIGEN' }, { platform: 'android', serial: 'DESTINO' },
    { photos: true, files: true, contacts: true, apps: true }, path.join(tmp, 'w1'), (p) => seen.push(p));
  assert.ok(r.hecho.includes('fotos y vídeos'));
  assert.ok(r.hecho.includes('2 contactos'));
  assert.ok(r.hecho.some((h) => /^1 de 1 apps/.test(h)));
  assert.match(r.avisos.join(' '), /Importar contactos/);
  const log = calls();
  assert.match(log, /-s ORIGEN pull -a \/sdcard\/DCIM/);
  assert.match(log, /-s DESTINO push .*DCIM \/sdcard\//);
  assert.match(log, /-s DESTINO push .*contactos\.vcf \/sdcard\/Download\/contactos-migrados\.vcf/);
  assert.match(log, /-s DESTINO install-multiple -r/);
  assert.equal(seen.at(-1).percent, 100);
});

test('iPhone → Android: copia del iPhone, fotos con sus carpetas y contactos', { skip }, async () => {
  process.env.FAKE_NO_IMPORT = '1';
  try {
    const r = await M.migrate({ platform: 'ios', serial: UDID }, { platform: 'android', serial: 'DESTINO' }, { photos: true, contacts: true, fresh: true }, path.join(tmp, 'w2'));
    assert.deepEqual(r.hecho, ['3 fotos/vídeos', '2 contactos']);
    assert.match(r.avisos.join(' '), /Descargas\/contactos-migrados\.vcf/);
    assert.match(calls(), new RegExp(`idevicebackup2 -u ${UDID} backup --full`));
    assert.match(calls(), /-s DESTINO push .*fotos-iphone \/sdcard\/DCIM\//);
    assert.ok(fs.existsSync(path.join(tmp, 'w2', 'fotos-iphone', '100APPLE', 'IMG_0001.JPG')));
  } finally { delete process.env.FAKE_NO_IMPORT; }
});

test('iPhone → iPhone: copia completa del origen y restauración en el destino', { skip }, async () => {
  const r = await M.migrate({ platform: 'ios', serial: UDID }, { platform: 'ios', serial: 'DEST-UDID' }, {}, path.join(tmp, 'w3'));
  assert.deepEqual(r.hecho, ['copia completa']);
  assert.match(calls(), new RegExp(`idevicebackup2 -u DEST-UDID -s ${UDID} restore --system --settings --reboot`));
});

test('errores claros: mismo teléfono, Android → iPhone y nada elegido', async () => {
  await assert.rejects(M.migrate({ platform: 'android', serial: 'A' }, { platform: 'android', serial: 'A' }, { photos: true }, tmp), /mismo teléfono/);
  await assert.rejects(M.migrate({ platform: 'android', serial: 'A' }, { platform: 'ios', serial: 'B' }, { photos: true }, tmp), /Pasar a iOS/);
  await assert.rejects(M.migrate({ platform: 'android', serial: 'A' }, { platform: 'android', serial: 'B' }, {}, tmp), /Elige/);
});
