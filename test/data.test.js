'use strict';
// Copias, fotos, contactos, mensajes y archivos en Android e iPhone (con binarios falsos).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skip = process.platform === 'win32' ? 'los binarios falsos son scripts sh' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-data-'));
process.env.PATH = `${path.join(__dirname, 'fake-bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_LOG = path.join(tmp, 'calls.log');
const iosData = require('../src/main/ios-data');
const androidData = require('../src/main/android-data');
const { makeBackup } = require('./helpers/make-ios-backup');
const { parseVcf } = require('../src/main/vcard');
const UDID = '00008110-001A2B3C4D5E801E';
const calls = () => (fs.existsSync(process.env.FAKE_LOG) ? fs.readFileSync(process.env.FAKE_LOG, 'utf8') : '');

// ── iPhone ──────────────────────────────────────────────────────────────────
test('iPhone: copia completa con progreso y detección de la copia', { skip }, async () => {
  const dest = path.join(tmp, 'copias');
  const seen = [];
  const job = iosData.backup(UDID, dest, (p) => seen.push(p));
  const r = await job.done;
  assert.equal(r.dir, path.join(dest, UDID));
  assert.equal(r.encrypted, false);
  assert.ok(seen.some((p) => p.percent === 52), 'informa del progreso intermedio');
  assert.equal(seen.at(-1).percent, 100);
  assert.match(calls(), new RegExp(`idevicebackup2 -u ${UDID} backup --full`));
  const found = iosData.findBackups(dest);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'iPhone de prueba');
  assert.equal(found[0].encrypted, false);
});

test('iPhone: extraer fotos y vídeos de la copia conservando carpetas', { skip }, async () => {
  const dir = await makeBackup(path.join(tmp, 'b1'), UDID);
  const out = path.join(tmp, 'fotos');
  const r = await iosData.extractPhotos(dir, out);
  assert.equal(r.count, 3);
  assert.deepEqual(fs.readdirSync(path.join(out, '100APPLE')).sort(), ['IMG_0001.JPG', 'IMG_0002.HEIC']);
  assert.ok(fs.existsSync(path.join(out, '101APPLE', 'IMG_0100.MOV')));
  assert.equal(fs.readFileSync(path.join(out, '100APPLE', 'IMG_0001.JPG'))[0], 0xff);
  assert.ok(!fs.existsSync(path.join(out, 'Photos.sqlite')), 'no copia la base de datos de Fotos');
});

test('iPhone: contactos a VCF (nombre, empresa, teléfonos, correo, caracteres especiales)', { skip }, async () => {
  const dir = await makeBackup(path.join(tmp, 'b2'), UDID);
  const r = await iosData.exportContacts(dir, path.join(tmp, 'c'));
  assert.equal(r.count, 2);
  const back = parseVcf(fs.readFileSync(r.file, 'utf8'));
  const ana = back.find((c) => c.first === 'Ana');
  assert.equal(ana.last, 'García López');
  assert.deepEqual(ana.phones.map((p) => p.value), ['+34 600 111 222']);
  assert.deepEqual(ana.emails.map((e) => e.value), ['ana@example.com']);
  const taller = back.find((c) => c.org === 'Taller, S.L.');
  assert.equal(taller.note, 'Cliente; VIP');
  assert.match(fs.readFileSync(r.file, 'utf8'), /TEL;TYPE=CELL:\+34 600 111 222/);
});

test('iPhone: mensajes a CSV con fechas de Apple, dirección y adjuntos', { skip }, async () => {
  const dir = await makeBackup(path.join(tmp, 'b3'), UDID);
  const msgs = await iosData.readMessages(dir);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].texto, 'Hola, ¿está listo el móvil?');
  assert.equal(msgs[0].tipo, 'Recibido');
  assert.equal(msgs[1].tipo, 'Enviado');
  assert.equal(msgs[2].texto, '[adjunto]');
  assert.equal(msgs[0].fecha, '2023-11-14 22:13:20'); // 721692800 s desde 2001 = 1700000000 Unix
  const r = await iosData.exportMessages(dir, path.join(tmp, 'm'));
  const csv = fs.readFileSync(r.file, 'utf8');
  assert.ok(csv.startsWith('\ufeffFecha (UTC);Conversación'));
  assert.match(csv, /"Sí; pásate a las ""5"""/);
});

test('iPhone: fechas antiguas (segundos) y modernas (nanosegundos)', () => {
  assert.equal(iosData.appleDate(0), '');
  assert.equal(iosData.appleDate(500000000), '2016-11-05 00:53:20');
  assert.equal(iosData.appleDate(500000000 * 1e9), '2016-11-05 00:53:20');
});

test('iPhone: copia cifrada da un mensaje claro', { skip }, async () => {
  const dir = await makeBackup(path.join(tmp, 'b4'), UDID, { encrypted: true });
  assert.equal(iosData.findBackups(path.dirname(dir))[0].encrypted, true);
  await assert.rejects(iosData.extractPhotos(dir, path.join(tmp, 'x')), /cifrada/);
});

test('iPhone: explorar la copia y extraer un archivo concreto', { skip }, async () => {
  const dir = await makeBackup(path.join(tmp, 'b5'), UDID);
  const hits = await iosData.browse(dir, 'sms.db');
  assert.equal(hits.length, 1);
  const r = await iosData.extractFiles(dir, [hits[0].id], path.join(tmp, 'ex'));
  assert.equal(r.count, 1);
  assert.ok(fs.existsSync(path.join(tmp, 'ex', 'HomeDomain', 'Library', 'SMS', 'sms.db')));
});

test('iPhone: restaurar (y migrar desde otro iPhone) y aviso de «Buscar mi iPhone»', { skip }, async () => {
  await iosData.restore(UDID, path.join(tmp, 'copias'), 'OTRO-UDID').done;
  assert.match(calls(), new RegExp(`idevicebackup2 -u ${UDID} -s OTRO-UDID restore --system --settings --reboot`));
  process.env.FAKE_FINDMY = '1';
  try {
    await assert.rejects(iosData.restore(UDID, path.join(tmp, 'copias')).done, /Buscar mi iPhone/);
  } finally { delete process.env.FAKE_FINDMY; }
});

test('iPhone: cancelar una copia en curso', { skip }, async () => {
  const job = iosData.backup(UDID, path.join(tmp, 'cancel'));
  job.child.kill();
  await assert.rejects(job.done, /cancelada|código/);
});

// ── Android ─────────────────────────────────────────────────────────────────
test('Android: contactos a VCF (agrupa filas por contacto, valores con comas)', { skip }, async () => {
  const r = await androidData.exportContacts('R58M12ABCDE', path.join(tmp, 'ac'));
  assert.equal(r.count, 2);
  const back = parseVcf(fs.readFileSync(r.file, 'utf8'));
  assert.equal(back[0].name, 'Luis Pérez');
  assert.deepEqual(back[0].phones.map((p) => p.value), ['+34 611 22 33 44']);
  assert.equal(back[1].org, 'Recambios, S.A.');
});

test('Android: SMS a CSV con texto de varias líneas', { skip }, async () => {
  const r = await androidData.exportMessages('R58M12ABCDE', path.join(tmp, 'as'));
  assert.equal(r.count, 2);
  const csv = fs.readFileSync(r.file, 'utf8');
  assert.match(csv, /"Hola, ¿qué tal\?\r?\nSegunda línea"/);
  assert.match(csv, /2023-11-14 22:13:20;\+34611223344;Recibido/);
});

test('Android: SMS bloqueado por el sistema da un mensaje claro', { skip }, async () => {
  process.env.FAKE_SMS_DENIED = '1';
  try { await assert.rejects(androidData.exportMessages('R58M12ABCDE', tmp), /no deja leer los SMS/); } finally { delete process.env.FAKE_SMS_DENIED; }
});

test('Android: copia completa con apps y restauración', { skip }, async () => {
  const dest = path.join(tmp, 'acopia');
  const seen = [];
  const r = await androidData.backup('R58M12ABCDE', dest, { apps: true }, (p) => seen.push(p));
  assert.deepEqual(r.carpetas, ['DCIM', 'Download']);
  assert.deepEqual(r.apps, ['com.ejemplo.app']);
  assert.equal(r.contactos, 2);
  assert.equal(r.sms, 2);
  assert.ok(fs.existsSync(path.join(dest, 'sdcard', 'DCIM', 'Camera', 'IMG_1.jpg')));
  assert.deepEqual(fs.readdirSync(path.join(dest, 'apps', 'com.ejemplo.app')).sort(), ['base.apk', 'split_es.apk']);
  assert.equal(seen.at(-1).percent, 100);

  const rr = await androidData.restore('R58M12ABCDE', dest);
  assert.equal(rr.carpetas, 2);
  assert.equal(rr.apps, 1);
  assert.match(calls(), /install-multiple -r .*base\.apk .*split_es\.apk/);
  assert.match(calls(), /push .*contactos\.vcf \/sdcard\/Download\/contactos-restaurados\.vcf/);
  await assert.rejects(androidData.restore('R58M12ABCDE', tmp), /no es una copia/);
});

test('Android: copiar fotos al PC y enviarlas al teléfono', { skip }, async () => {
  const r = await androidData.copyPhotos('R58M12ABCDE', path.join(tmp, 'afotos'));
  assert.equal(r.folders, 2);
  const f = path.join(tmp, "foto de 'prueba'.jpg"); fs.writeFileSync(f, 'x');
  const s = await androidData.sendPhotos('R58M12ABCDE', [f]);
  assert.equal(s.count, 1);
  assert.match(calls(), /MEDIA_SCANNER_SCAN_FILE -d 'file:\/\/\/sdcard\/DCIM\/ServicioMovil\/foto de '\\''prueba'\\''\.jpg'/);
});

test('Android: explorador de archivos (nombres con espacios, sin . ni ..)', { skip }, async () => {
  const l = await androidData.listDir('R58M12ABCDE', '/sdcard/');
  assert.deepEqual(l.map((e) => [e.name, e.dir]), [['DCIM', true], ['nota con espacios.txt', false]]);
  assert.match(calls(), /shell cd '\/sdcard' && for f in '\/sdcard'\/\* '\/sdcard'\/\.\*/);
});
