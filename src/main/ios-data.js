'use strict';
// Datos de iPhone/iPad: copia completa con idevicebackup2 y extracción de fotos, contactos y
// mensajes desde esa copia (Manifest.db). Así funciona igual en cualquier versión de iOS,
// sin jailbreak y sin tocar la activación.
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');
const P = require('./parsers');
const { toVcf, toCsv } = require('./vcard');

let SQL = null;
async function sqlite() {
  if (!SQL) {
    const init = require('sql.js');
    const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
    SQL = await init({ locateFile: () => wasm });
  }
  return SQL;
}

// ── Copia y restauración ────────────────────────────────────────────────────
async function backupEncryption(udid) {
  try {
    const { stdout } = await tools.run('ideviceinfo', ['-u', udid, '-q', 'com.apple.mobile.backup', '-k', 'WillEncrypt'], { timeout: 10000 });
    return stdout.trim() === 'true';
  } catch { return null; }
}

/** Ejecuta idevicebackup2 informando del progreso; devuelve el proceso para poder cancelarlo. */
function runBackup2(args, progress) {
  let lastPct = 0;
  const job = tools.runStream('idevicebackup2', args, (line) => {
    const pct = P.parseBackupProgress(line);
    if (pct !== null) lastPct = pct;
    if (/Please (unlock|enter the passcode)|Enter passcode/i.test(line)) progress({ text: 'Desbloquea el iPhone e introduce el código si te lo pide.', percent: lastPct });
    else if (pct !== null) progress({ text: `Copiando… ${pct}%`, percent: pct });
    else if (/Receiving files|Sending files|Backup Successful|Restore Successful|Requesting backup|Requesting restore/i.test(line)) progress({ text: line.trim(), percent: lastPct });
  });
  return job;
}

/**
 * Copia completa (como iTunes). Si el usuario tiene activado el cifrado de copias en el iPhone,
 * la copia sale cifrada y no se pueden extraer fotos/contactos/mensajes de ella sin la contraseña.
 */
function backup(udid, dest, progress = () => {}) {
  fs.mkdirSync(dest, { recursive: true });
  progress({ text: 'Iniciando copia… (desbloquea el iPhone si lo pide)', percent: 0 });
  const job = runBackup2(['-u', udid, 'backup', '--full', dest], progress);
  job.done = job.done.then(async () => {
    const encrypted = await backupEncryption(udid);
    progress({ text: 'Copia terminada.', percent: 100 });
    return { dest, dir: path.join(dest, udid), encrypted };
  });
  return job;
}

/**
 * Restaura una copia en el dispositivo. iOS exige que «Buscar mi iPhone» esté desactivado
 * para restaurar: es una protección de Apple y no se salta.
 * @param {string} backupRoot carpeta que contiene la subcarpeta <udid-origen>
 */
function restore(udid, backupRoot, sourceUdid, progress = () => {}) {
  const args = ['-u', udid];
  if (sourceUdid && sourceUdid !== udid) args.push('-s', sourceUdid); // restaurar la copia de otro iPhone (migración)
  args.push('restore', '--system', '--settings', '--reboot', backupRoot);
  const job = runBackup2(args, progress);
  job.done = job.done.catch((e) => {
    if (/Find My|FindMy|find my/i.test(e.message)) throw new Error('Desactiva «Buscar mi iPhone» en el iPhone de destino (Ajustes > tu nombre > Buscar) y vuelve a intentarlo.');
    throw e;
  }).then(() => { progress({ text: 'Restauración enviada. El iPhone se reiniciará.', percent: 100 }); return true; });
  return job;
}

/** Busca copias (carpetas con Manifest.db) dentro de una carpeta. */
function findBackups(root) {
  const out = [];
  const consider = (dir) => {
    const mdb = path.join(dir, 'Manifest.db');
    if (!fs.existsSync(mdb)) return;
    const info = readInfoPlist(dir);
    out.push({ dir, udid: path.basename(dir), name: info.DeviceName || info['Device Name'] || null, product: info['Product Type'] || null, date: info['Last Backup Date'] || null, encrypted: isEncryptedDb(mdb) });
  };
  consider(root);
  if (fs.existsSync(root)) for (const d of fs.readdirSync(root)) { try { if (fs.statSync(path.join(root, d)).isDirectory()) consider(path.join(root, d)); } catch {} }
  return out;
}

function readInfoPlist(dir) {
  // Info.plist de la copia es XML: basta con leer los pares <key>/<string|date>.
  const f = path.join(dir, 'Info.plist');
  const out = {};
  if (!fs.existsSync(f)) return out;
  const xml = fs.readFileSync(f, 'utf8');
  const re = /<key>([^<]+)<\/key>\s*<(string|date)>([^<]*)<\/\2>/g;
  let m;
  while ((m = re.exec(xml)) !== null) if (!(m[1] in out)) out[m[1]] = m[3];
  return out;
}

function isEncryptedDb(file) {
  try {
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd);
    return b.toString('latin1') !== 'SQLite format 3\u0000';
  } catch { return true; }
}

// ── Lectura de la copia ─────────────────────────────────────────────────────
class Backup {
  static async open(dir) {
    const mdb = path.join(dir, 'Manifest.db');
    if (!fs.existsSync(mdb)) throw new Error('No hay ninguna copia de iPhone en esa carpeta (falta Manifest.db).');
    if (isEncryptedDb(mdb)) throw new Error('La copia está cifrada. Desactiva «Cifrar copia local» (o haz la copia sin cifrar) para poder extraer fotos, contactos y mensajes.');
    const S = await sqlite();
    const b = new Backup();
    b.dir = dir;
    b.db = new S.Database(fs.readFileSync(mdb));
    return b;
  }

  /** Archivos (flags=1) de un dominio cuyo relativePath cumple LIKE pattern. */
  files(domain, like) {
    const st = this.db.prepare('SELECT fileID, relativePath FROM Files WHERE domain = ? AND relativePath LIKE ? AND flags = 1 ORDER BY relativePath');
    st.bind([domain, like]);
    const out = [];
    while (st.step()) { const r = st.getAsObject(); out.push({ id: r.fileID, rel: r.relativePath, src: this.blobPath(r.fileID) }); }
    st.free();
    return out;
  }

  blobPath(id) { return path.join(this.dir, id.slice(0, 2), id); }

  async openDb(domain, rel) {
    const f = this.files(domain, rel)[0];
    if (!f || !fs.existsSync(f.src)) return null;
    const S = await sqlite();
    return new S.Database(fs.readFileSync(f.src));
  }

  /** Lista navegable de toda la copia (para el explorador de la copia). */
  search(text, limit = 500) {
    const st = this.db.prepare('SELECT fileID, domain, relativePath FROM Files WHERE flags = 1 AND (relativePath LIKE ? OR domain LIKE ?) ORDER BY domain, relativePath LIMIT ?');
    const q = `%${text || ''}%`;
    st.bind([q, q, limit]);
    const out = [];
    while (st.step()) { const r = st.getAsObject(); out.push({ id: r.fileID, domain: r.domain, rel: r.relativePath }); }
    st.free();
    return out;
  }

  close() { this.db.close(); }
}

const query = (db, sql) => { const r = db.exec(sql)[0]; return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : []; };

async function extractPhotos(dir, dest, progress = () => {}) {
  const b = await Backup.open(dir);
  try {
    const files = b.files('CameraRollDomain', 'Media/DCIM/%');
    let copied = 0; let missing = 0;
    files.forEach((f, i) => {
      if (i % 25 === 0) progress({ text: `Extrayendo fotos ${i}/${files.length}…`, percent: Math.round((i / Math.max(1, files.length)) * 100) });
      const out = path.join(dest, ...f.rel.replace(/^Media\/DCIM\//, '').split('/'));
      if (!fs.existsSync(f.src)) { missing++; return; }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(f.src, out);
      copied++;
    });
    progress({ text: 'Fotos extraídas.', percent: 100 });
    return { dest, count: copied, missing, note: copied === 0 ? 'La copia no contiene fotos: si el iPhone usa «Fotos en iCloud» con «Optimizar almacenamiento», las fotos están en iCloud y no en el teléfono.' : null };
  } finally { b.close(); }
}

const AB_PHONE = 3; const AB_EMAIL = 4;
async function readContacts(dir) {
  const b = await Backup.open(dir);
  try {
    const db = await b.openDb('HomeDomain', 'Library/AddressBook/AddressBook.sqlitedb');
    if (!db) return [];
    const people = query(db, 'SELECT ROWID AS id, First AS first, Last AS last, Organization AS org, Note AS note FROM ABPerson');
    const labels = Object.fromEntries(query(db, 'SELECT ROWID AS id, value FROM ABMultiValueLabel').map((l) => [l.id, l.value]));
    const mv = query(db, `SELECT record_id AS rid, property AS prop, label, value FROM ABMultiValue WHERE property IN (${AB_PHONE}, ${AB_EMAIL})`);
    const byId = new Map(people.map((p) => [p.id, { first: p.first || '', last: p.last || '', org: p.org || '', note: p.note || '', phones: [], emails: [] }]));
    const typeOf = (label) => { const l = String(labels[label] || ''); return /mobile|iPhone/i.test(l) ? 'CELL' : /home/i.test(l) ? 'HOME' : /work/i.test(l) ? 'WORK' : /fax/i.test(l) ? 'FAX' : 'CELL'; };
    for (const v of mv) {
      const c = byId.get(v.rid);
      if (!c || !v.value) continue;
      if (v.prop === AB_PHONE) c.phones.push({ value: String(v.value), type: typeOf(v.label) });
      else c.emails.push({ value: String(v.value) });
    }
    db.close();
    return [...byId.values()];
  } finally { b.close(); }
}

async function exportContacts(dir, dest) {
  const contacts = await readContacts(dir);
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'contactos-iphone.vcf');
  fs.writeFileSync(file, toVcf(contacts));
  return { file, count: contacts.length };
}

/** Fecha de Messages: segundos (iOS < 11) o nanosegundos (iOS ≥ 11) desde 2001-01-01. */
function appleDate(v) {
  const n = Number(v);
  if (!n) return '';
  const secs = n > 1e11 ? n / 1e9 : n;
  return new Date((secs + 978307200) * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function readMessages(dir) {
  const b = await Backup.open(dir);
  try {
    const db = await b.openDb('HomeDomain', 'Library/SMS/sms.db');
    if (!db) return [];
    const rows = query(db, `SELECT m.date AS date, m.is_from_me AS fromMe, m.text AS text, m.service AS service,
        h.id AS handle, c.chat_identifier AS chat, c.display_name AS chatName,
        (SELECT COUNT(*) FROM message_attachment_join j WHERE j.message_id = m.ROWID) AS adjuntos
      FROM message m
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      LEFT JOIN chat c ON c.ROWID = cmj.chat_id
      ORDER BY m.date`);
    db.close();
    return rows.map((r) => ({
      fecha: appleDate(r.date),
      conversacion: r.chatName || r.chat || r.handle || '',
      numero: r.handle || '',
      tipo: r.fromMe ? 'Enviado' : 'Recibido',
      servicio: r.service || '',
      texto: r.text || (r.adjuntos ? '[adjunto]' : ''),
    }));
  } finally { b.close(); }
}

async function exportMessages(dir, dest) {
  const rows = await readMessages(dir);
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'mensajes-iphone.csv');
  fs.writeFileSync(file, toCsv(rows, [
    { key: 'fecha', label: 'Fecha (UTC)' }, { key: 'conversacion', label: 'Conversación' }, { key: 'numero', label: 'Número' },
    { key: 'tipo', label: 'Tipo' }, { key: 'servicio', label: 'Servicio' }, { key: 'texto', label: 'Mensaje' },
  ]));
  return { file, count: rows.length };
}

async function browse(dir, text) {
  const b = await Backup.open(dir);
  try { return b.search(text); } finally { b.close(); }
}

async function extractFiles(dir, ids, dest) {
  const b = await Backup.open(dir);
  try {
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const id of ids) {
      const st = b.db.prepare('SELECT domain, relativePath FROM Files WHERE fileID = ?'); st.bind([id]);
      if (st.step()) {
        const r = st.getAsObject();
        const src = b.blobPath(id);
        if (fs.existsSync(src)) {
          const out = path.join(dest, r.domain.replace(/[^\w.-]/g, '_'), ...r.relativePath.split('/'));
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.copyFileSync(src, out); n++;
        }
      }
      st.free();
    }
    return { dest, count: n };
  } finally { b.close(); }
}

module.exports = {
  backup, restore, findBackups, backupEncryption, extractPhotos, exportContacts, exportMessages,
  readContacts, readMessages, browse, extractFiles, appleDate, Backup,
};
