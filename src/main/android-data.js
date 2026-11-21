'use strict';
// Datos de Android sin root: copias de carpetas y apps, fotos, contactos, SMS y archivos.
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');
const P = require('./parsers');
const { toVcf, toCsv } = require('./vcard');

const sh = (serial, cmd, opts) => tools.run('adb', ['-s', serial, 'shell', cmd], opts).then((r) => r.stdout);

/** Carpetas del almacenamiento compartido que se copian en una copia de seguridad. */
const USER_FOLDERS = ['DCIM', 'Pictures', 'Movies', 'Music', 'Download', 'Documents', 'Recordings', 'Ringtones', 'Notifications', 'Alarms', 'Podcasts', 'Audiobooks'];
const PHOTO_FOLDERS = ['DCIM', 'Pictures', 'Movies'];

async function existingFolders(serial, names) {
  const out = await sh(serial, `for d in ${names.map((n) => tools.shq(`/sdcard/${n}`)).join(' ')}; do [ -d "$d" ] && echo "$d"; done; true`);
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Copia una carpeta del teléfono a local. */
function pull(serial, remote, localDir) {
  fs.mkdirSync(localDir, { recursive: true });
  return tools.run('adb', ['-s', serial, 'pull', '-a', remote, localDir], { timeout: 0 });
}

// ── Contactos ───────────────────────────────────────────────────────────────
const CONTACT_KEYS = ['contact_id', 'mimetype', 'data1', 'data2', 'data3'];
const PHONE_TYPES = { 1: 'HOME', 2: 'CELL', 3: 'WORK', 4: 'FAX', 7: 'OTHER', 12: 'MAIN' };

function contactsFromRows(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!r.contact_id) continue;
    if (!byId.has(r.contact_id)) byId.set(r.contact_id, { phones: [], emails: [] });
    const c = byId.get(r.contact_id);
    switch (r.mimetype) {
      case 'vnd.android.cursor.item/name': c.name = r.data1 || c.name; c.first = r.data2 || ''; c.last = r.data3 || ''; break;
      case 'vnd.android.cursor.item/phone_v2': if (r.data1 && !c.phones.some((p) => p.value === r.data1)) c.phones.push({ value: r.data1, type: PHONE_TYPES[r.data2] || 'CELL' }); break;
      case 'vnd.android.cursor.item/email_v2': if (r.data1) c.emails.push({ value: r.data1 }); break;
      case 'vnd.android.cursor.item/organization': if (r.data1) c.org = r.data1; break;
      case 'vnd.android.cursor.item/note': if (r.data1) c.note = r.data1; break;
      default:
    }
  }
  return [...byId.values()];
}

async function readContacts(serial) {
  const out = await sh(serial, `content query --uri content://com.android.contacts/data --projection ${CONTACT_KEYS.join(':')}`, { timeout: 120000 });
  if (/Permission Denial|SecurityException/.test(out)) throw new Error('Android no permite leer los contactos desde ADB en este teléfono.');
  return contactsFromRows(P.parseContentQuery(out, CONTACT_KEYS));
}

async function exportContacts(serial, outDir) {
  const contacts = await readContacts(serial);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'contactos.vcf');
  fs.writeFileSync(file, toVcf(contacts));
  return { file, count: contacts.length };
}

// ── SMS ─────────────────────────────────────────────────────────────────────
const SMS_KEYS = ['address', 'date', 'type', 'read', 'body'];
const SMS_TYPE = { 1: 'Recibido', 2: 'Enviado', 3: 'Borrador', 4: 'Saliente', 5: 'Fallido', 6: 'En cola' };

async function exportMessages(serial, outDir) {
  const out = await sh(serial, `content query --uri content://sms --projection ${SMS_KEYS.join(':')} --sort 'date ASC'`, { timeout: 300000 });
  if (/Permission Denial|SecurityException|requires android.permission.READ_SMS/.test(out)) {
    throw new Error('Este Android no deja leer los SMS desde ADB (restricción del sistema). Usa la app de mensajes del fabricante para exportarlos.');
  }
  const rows = P.parseContentQuery(out, SMS_KEYS).map((r) => ({
    fecha: r.date ? new Date(Number(r.date)).toISOString().replace('T', ' ').slice(0, 19) : '',
    numero: r.address || '',
    tipo: SMS_TYPE[r.type] || r.type || '',
    texto: r.body || '',
  }));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'mensajes-sms.csv');
  fs.writeFileSync(file, toCsv(rows, [{ key: 'fecha', label: 'Fecha (UTC)' }, { key: 'numero', label: 'Número' }, { key: 'tipo', label: 'Tipo' }, { key: 'texto', label: 'Mensaje' }]));
  return { file, count: rows.length };
}

// ── Apps ────────────────────────────────────────────────────────────────────
async function userPackages(serial) {
  return P.parsePmPackages(await sh(serial, 'pm list packages -3'));
}

async function backupApk(serial, pkg, dir) {
  const paths = (await sh(serial, `pm path ${tools.shq(pkg)}`)).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('package:')).map((l) => l.slice(8));
  const dest = path.join(dir, pkg);
  fs.mkdirSync(dest, { recursive: true });
  for (const p of paths) await tools.run('adb', ['-s', serial, 'pull', p, dest], { timeout: 0 });
  return paths.length;
}

async function installApkSet(serial, dir) {
  const apks = fs.readdirSync(dir).filter((f) => /\.apk$/i.test(f)).map((f) => path.join(dir, f));
  if (!apks.length) return false;
  const args = apks.length === 1 ? ['install', '-r', apks[0]] : ['install-multiple', '-r', ...apks];
  const { stdout } = await tools.run('adb', ['-s', serial, ...args], { timeout: 10 * 60000 });
  if (!/Success/.test(stdout)) throw new Error(stdout.trim());
  return true;
}

// ── Copia completa ──────────────────────────────────────────────────────────
/**
 * Copia: carpetas de usuario, contactos (VCF), SMS (CSV si el sistema lo permite) y, opcionalmente, APK de apps.
 * Los datos internos de las apps no se pueden copiar sin root (Android lo impide desde la versión 12).
 */
async function backup(serial, dest, { apps = false } = {}, progress = () => {}) {
  fs.mkdirSync(dest, { recursive: true });
  const manifest = { tipo: 'servicio-movil-android', version: 1, serial, fecha: new Date().toISOString(), carpetas: [], apps: [], avisos: [] };
  const folders = await existingFolders(serial, USER_FOLDERS);
  const pkgs = apps ? await userPackages(serial) : [];
  const steps = folders.length + 2 + pkgs.length;
  let n = 0;
  const step = (text) => progress({ text, percent: Math.round((n++ / steps) * 100) });

  for (const f of folders) {
    step(`Copiando ${f.replace('/sdcard/', '')}…`);
    await pull(serial, f, path.join(dest, 'sdcard'));
    manifest.carpetas.push(f.replace('/sdcard/', ''));
  }
  step('Exportando contactos…');
  try { manifest.contactos = (await exportContacts(serial, dest)).count; } catch (e) { manifest.avisos.push(e.message); }
  step('Exportando SMS…');
  try { manifest.sms = (await exportMessages(serial, dest)).count; } catch (e) { manifest.avisos.push(e.message); }
  for (const pkg of pkgs) {
    step(`Copiando app ${pkg}…`);
    try { await backupApk(serial, pkg, path.join(dest, 'apps')); manifest.apps.push(pkg); } catch (e) { manifest.avisos.push(`${pkg}: ${e.message}`); }
  }
  fs.writeFileSync(path.join(dest, 'servicio-movil.json'), JSON.stringify(manifest, null, 2));
  progress({ text: 'Copia terminada.', percent: 100 });
  return { dest, ...manifest };
}

async function restore(serial, src, progress = () => {}) {
  const mf = path.join(src, 'servicio-movil.json');
  if (!fs.existsSync(mf)) throw new Error('Esa carpeta no es una copia de MVR Servicio Móvil (falta servicio-movil.json).');
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const sd = path.join(src, 'sdcard');
  const folders = fs.existsSync(sd) ? fs.readdirSync(sd).filter((d) => fs.statSync(path.join(sd, d)).isDirectory()) : [];
  const appsDir = path.join(src, 'apps');
  const apps = fs.existsSync(appsDir) ? fs.readdirSync(appsDir) : [];
  const steps = folders.length + apps.length + 1;
  let n = 0;
  const step = (text) => progress({ text, percent: Math.round((n++ / steps) * 100) });
  const avisos = [];
  for (const f of folders) {
    step(`Restaurando ${f}…`);
    await tools.run('adb', ['-s', serial, 'push', path.join(sd, f), '/sdcard/'], { timeout: 0 });
  }
  for (const a of apps) {
    step(`Instalando ${a}…`);
    try { await installApkSet(serial, path.join(appsDir, a)); } catch (e) { avisos.push(`${a}: ${e.message}`); }
  }
  step('Contactos…');
  const vcf = path.join(src, 'contactos.vcf');
  if (fs.existsSync(vcf)) {
    await tools.run('adb', ['-s', serial, 'push', vcf, '/sdcard/Download/contactos-restaurados.vcf']);
    avisos.push('Contactos copiados a Descargas/contactos-restaurados.vcf: ábrelo en el teléfono y elige «Importar» en Contactos.');
  }
  // Pide al sistema que indexe las fotos copiadas (Android 11+; en versiones anteriores lo hace solo).
  await sh(serial, 'content call --uri content://media/none --method scan_volume --arg external_primary').catch(() => {});
  progress({ text: 'Restauración terminada.', percent: 100 });
  return { carpetas: folders.length, apps: apps.length, avisos, origen: manifest.serial };
}

// ── Fotos ───────────────────────────────────────────────────────────────────
async function copyPhotos(serial, dest, progress = () => {}) {
  const folders = await existingFolders(serial, PHOTO_FOLDERS);
  let i = 0;
  for (const f of folders) {
    progress({ text: `Copiando ${f.replace('/sdcard/', '')}…`, percent: Math.round((i++ / folders.length) * 100) });
    await pull(serial, f, dest);
  }
  progress({ text: 'Fotos copiadas.', percent: 100 });
  return { dest, folders: folders.length };
}

/** Envía fotos/vídeos del PC al teléfono (DCIM/ServicioMovil) y los indexa en la galería. */
async function sendPhotos(serial, files, progress = () => {}) {
  const target = '/sdcard/DCIM/ServicioMovil';
  await sh(serial, `mkdir -p ${tools.shq(target)}`);
  let i = 0;
  for (const f of files) {
    progress({ text: `Enviando ${path.basename(f)}…`, percent: Math.round((i++ / files.length) * 100) });
    await tools.run('adb', ['-s', serial, 'push', f, `${target}/`], { timeout: 0 });
    await sh(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${tools.shq(`file://${target}/${path.basename(f)}`)}`).catch(() => {});
  }
  await sh(serial, 'content call --uri content://media/none --method scan_volume --arg external_primary').catch(() => {});
  progress({ text: 'Enviado.', percent: 100 });
  return { count: files.length, target };
}

// ── Archivos ────────────────────────────────────────────────────────────────
async function listDir(serial, dir) {
  const d = dir.replace(/\/+$/, '') || '/';
  const q = tools.shq(d === '/' ? '' : d);
  const out = await sh(serial, `cd ${tools.shq(d)} && for f in ${q}/* ${q}/.*; do [ -e "$f" ] && stat -c '%F|%s|%Y|%n' "$f"; done; true`);
  if (/No such file|Permission denied|can't cd/.test(out) && !out.includes('|')) throw new Error(`No se puede abrir ${d}`);
  return P.parseStatList(out);
}

async function pullPaths(serial, remotes, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const r of remotes) await tools.run('adb', ['-s', serial, 'pull', '-a', r, dest], { timeout: 0 });
  return dest;
}

async function pushPaths(serial, locals, remoteDir) {
  for (const l of locals) await tools.run('adb', ['-s', serial, 'push', l, `${remoteDir.replace(/\/+$/, '')}/`], { timeout: 0 });
  return locals.length;
}

module.exports = {
  backup, restore, copyPhotos, sendPhotos, exportContacts, exportMessages, readContacts,
  listDir, pullPaths, pushPaths, userPackages, contactsFromRows, USER_FOLDERS,
};
