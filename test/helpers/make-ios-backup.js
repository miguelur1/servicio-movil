'use strict';
// Genera una copia de iPhone sin cifrar con la misma estructura que crea idevicebackup2 / iTunes:
// <dest>/<udid>/{Manifest.db, Info.plist, xx/<sha1>} con fotos, AddressBook.sqlitedb y sms.db.
// Se usa en las pruebas y como "idevicebackup2" falso.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function makeBackup(root, udid, { encrypted = false } = {}) {
  const initSql = require('sql.js');
  const SQL = await initSql({ locateFile: () => path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm') });
  const dir = path.join(root, udid);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = new SQL.Database();
  manifest.run('CREATE TABLE Files (fileID TEXT PRIMARY KEY, domain TEXT, relativePath TEXT, flags INTEGER, file BLOB)');
  const add = (domain, rel, data, flags = 1) => {
    const id = crypto.createHash('sha1').update(`${domain}-${rel}`).digest('hex');
    manifest.run('INSERT INTO Files VALUES (?,?,?,?,NULL)', [id, domain, rel, flags]);
    if (flags === 1) { fs.mkdirSync(path.join(dir, id.slice(0, 2)), { recursive: true }); fs.writeFileSync(path.join(dir, id.slice(0, 2), id), data); }
    return id;
  };
  add('CameraRollDomain', 'Media/DCIM', null, 2);
  add('CameraRollDomain', 'Media/DCIM/100APPLE/IMG_0001.JPG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  add('CameraRollDomain', 'Media/DCIM/100APPLE/IMG_0002.HEIC', Buffer.from('heic-data'));
  add('CameraRollDomain', 'Media/DCIM/101APPLE/IMG_0100.MOV', Buffer.from('mov-data'));
  add('CameraRollDomain', 'Media/PhotoData/Photos.sqlite', Buffer.from('no-es-foto'));

  const ab = new SQL.Database();
  ab.run(`CREATE TABLE ABPerson (ROWID INTEGER PRIMARY KEY, First TEXT, Last TEXT, Organization TEXT, Note TEXT);
    CREATE TABLE ABMultiValue (UID INTEGER PRIMARY KEY, record_id INTEGER, property INTEGER, identifier INTEGER, label INTEGER, value TEXT);
    CREATE TABLE ABMultiValueLabel (value TEXT);
    INSERT INTO ABMultiValueLabel (rowid, value) VALUES (1, '_$!<Mobile>!$_'), (2, '_$!<Work>!$_');
    INSERT INTO ABPerson VALUES (1, 'Ana', 'García López', NULL, NULL), (2, NULL, NULL, 'Taller, S.L.', 'Cliente; VIP');
    INSERT INTO ABMultiValue VALUES (1, 1, 3, 0, 1, '+34 600 111 222'), (2, 1, 4, 0, 2, 'ana@example.com'), (3, 2, 3, 0, 2, '910000000');`);
  add('HomeDomain', 'Library/AddressBook/AddressBook.sqlitedb', Buffer.from(ab.export()));

  const sms = new SQL.Database();
  sms.run(`CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, date INTEGER, is_from_me INTEGER, text TEXT, service TEXT, handle_id INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    INSERT INTO handle VALUES (1, '+34600111222');
    INSERT INTO chat VALUES (1, '+34600111222', '');
    INSERT INTO message VALUES (1, 721692800000000000, 0, 'Hola, ¿está listo el móvil?', 'iMessage', 1);
    INSERT INTO message VALUES (2, 721692860000000000, 1, 'Sí; pásate a las "5"', 'SMS', 1);
    INSERT INTO message VALUES (3, 721692900000000000, 0, NULL, 'iMessage', 1);
    INSERT INTO chat_message_join VALUES (1,1),(1,2),(1,3);
    INSERT INTO message_attachment_join VALUES (3, 1);`);
  add('HomeDomain', 'Library/SMS/sms.db', Buffer.from(sms.export()));

  const mbytes = Buffer.from(manifest.export());
  fs.writeFileSync(path.join(dir, 'Manifest.db'), encrypted ? crypto.randomBytes(mbytes.length) : mbytes);
  fs.writeFileSync(path.join(dir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>Device Name</key><string>iPhone de prueba</string><key>Product Type</key><string>iPhone14,5</string>
<key>Last Backup Date</key><date>2026-11-21T12:00:00Z</date></dict></plist>`);
  return dir;
}

module.exports = { makeBackup };

// Uso como binario falso: node make-ios-backup.js <dest> <udid>
if (require.main === module) {
  makeBackup(process.argv[2], process.argv[3]).then(() => {}, (e) => { console.error(e.message); process.exit(1); });
}
