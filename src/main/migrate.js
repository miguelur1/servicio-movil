'use strict';
// Migración de un teléfono a otro conectados a la vez. Usa el PC como paso intermedio.
//   Android → Android: fotos/vídeos, carpetas, contactos y (opcional) apps.
//   iPhone  → Android: fotos/vídeos y contactos (desde la copia del iPhone).
//   iPhone  → iPhone : copia completa del origen y restauración en el destino.
//   Android → iPhone : Apple no permite escribir fotos ni contactos en el iPhone por USB → se explica.
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');
const androidData = require('./android-data');
const iosData = require('./ios-data');

const FOLDERS = { photos: ['DCIM', 'Pictures', 'Movies'], files: ['Download', 'Documents', 'Music', 'Recordings'] };

function plan(from, to) {
  const k = `${from}>${to}`;
  if (k === 'android>android') return { ok: true, items: ['photos', 'files', 'contacts', 'apps'] };
  if (k === 'ios>android') return { ok: true, items: ['photos', 'contacts'] };
  if (k === 'ios>ios') return { ok: true, items: ['full'] };
  return { ok: false, reason: 'Apple no permite copiar fotos ni contactos a un iPhone por cable desde otro programa. Para pasar de Android a iPhone usa la app oficial «Pasar a iOS» de Apple durante la configuración del iPhone, o exporta los contactos (.vcf) y súbelos a iCloud.' };
}

async function pushDir(serial, localDir, remoteParent) {
  if (!fs.existsSync(localDir)) return 0;
  await tools.run('adb', ['-s', serial, 'shell', `mkdir -p ${tools.shq(remoteParent)}`]);
  await tools.run('adb', ['-s', serial, 'push', localDir, `${remoteParent.replace(/\/+$/, '')}/`], { timeout: 0 });
  return 1;
}

async function importContactsAndroid(serial, vcf) {
  const remote = '/sdcard/Download/contactos-migrados.vcf';
  await tools.run('adb', ['-s', serial, 'push', vcf, remote]);
  // Intenta abrir el asistente de importación de Contactos; si el fabricante no lo admite, queda en Descargas.
  try {
    const { stdout } = await tools.run('adb', ['-s', serial, 'shell', `am start -a android.intent.action.VIEW -t text/x-vcard -d ${tools.shq(`file://${remote}`)}`]);
    if (/Error|Exception/.test(stdout)) throw new Error(stdout);
    return 'Se ha abierto «Importar contactos» en el teléfono de destino: confírmalo en la pantalla. Si no aparece, abre Descargas/contactos-migrados.vcf.';
  } catch {
    return 'Contactos copiados a Descargas/contactos-migrados.vcf en el destino: ábrelo allí para importarlos.';
  }
}

/**
 * @param {{platform:string, serial:string}} src
 * @param {{platform:string, serial:string}} dst
 * @param {{photos?:boolean, files?:boolean, contacts?:boolean, apps?:boolean, fresh?:boolean}} opts
 * @param {string} work carpeta temporal en el PC
 */
async function migrate(src, dst, opts, work, progress = () => {}, onChild = () => {}) {
  if (src.serial === dst.serial) throw new Error('El origen y el destino son el mismo teléfono.');
  const p = plan(src.platform, dst.platform);
  if (!p.ok) throw new Error(p.reason);
  fs.mkdirSync(work, { recursive: true });
  const avisos = [];
  const hecho = [];

  if (src.platform === 'ios' && dst.platform === 'ios') {
    progress({ text: 'Copia completa del iPhone de origen…', percent: 0 });
    const b = iosData.backup(src.serial, work, (x) => progress({ text: `Origen: ${x.text}`, percent: Math.round((x.percent || 0) / 2) }));
    onChild(b.child);
    const r = await b.done;
    if (r.encrypted) avisos.push('La copia está cifrada: el iPhone de destino pedirá la contraseña de la copia.');
    progress({ text: 'Restaurando en el iPhone de destino…', percent: 50 });
    const rs = iosData.restore(dst.serial, work, src.serial, (x) => progress({ text: `Destino: ${x.text}`, percent: 50 + Math.round((x.percent || 0) / 2) }));
    onChild(rs.child);
    await rs.done;
    progress({ text: 'Migración completada. El iPhone de destino se reiniciará.', percent: 100 });
    return { hecho: ['copia completa'], avisos, work };
  }

  const steps = ['photos', 'files', 'contacts', 'apps'].filter((k) => opts[k] && p.items.includes(k));
  if (!steps.length) throw new Error('Elige al menos qué quieres pasar.');
  let iosDir = null;
  if (src.platform === 'ios') {
    const existing = !opts.fresh && iosData.findBackups(path.join(work, '..', '..', 'Copias')).find((b) => b.udid === src.serial && !b.encrypted);
    if (existing) iosDir = existing.dir;
    else {
      progress({ text: 'Haciendo copia del iPhone de origen…', percent: 0 });
      const b = iosData.backup(src.serial, path.join(work, 'copia-iphone'), (x) => progress({ text: `iPhone: ${x.text}`, percent: Math.round((x.percent || 0) * 0.4) }));
      onChild(b.child);
      const r = await b.done;
      if (r.encrypted) throw new Error('El iPhone de origen hace copias cifradas: desactiva «Cifrar copia local» para poder pasar fotos y contactos.');
      iosDir = r.dir;
    }
  }

  let n = 0;
  const base = src.platform === 'ios' ? 40 : 0;
  const tick = (text) => progress({ text, percent: base + Math.round((n++ / steps.length) * (100 - base)) });

  for (const step of steps) {
    if (step === 'photos') {
      tick('Pasando fotos y vídeos…');
      if (src.platform === 'ios') {
        const out = path.join(work, 'fotos-iphone');
        const r = await iosData.extractPhotos(iosDir, out);
        if (r.note) avisos.push(r.note);
        // En destino quedan en DCIM/iPhone/<100APPLE…>
        await pushDir(dst.serial, out, '/sdcard/DCIM');
        hecho.push(`${r.count} fotos/vídeos`);
      } else {
        for (const f of FOLDERS.photos) {
          const local = path.join(work, 'sdcard');
          try { await androidData.pullPaths(src.serial, [`/sdcard/${f}`], local); } catch { continue; }
          await pushDir(dst.serial, path.join(local, f), '/sdcard');
        }
        hecho.push('fotos y vídeos');
      }
      await tools.run('adb', ['-s', dst.serial, 'shell', 'content call --uri content://media/none --method scan_volume --arg external_primary']).catch(() => {});
    } else if (step === 'files') {
      tick('Pasando archivos (Descargas, Documentos, Música…)…');
      const local = path.join(work, 'sdcard');
      for (const f of FOLDERS.files) {
        try { await androidData.pullPaths(src.serial, [`/sdcard/${f}`], local); } catch { continue; }
        await pushDir(dst.serial, path.join(local, f), '/sdcard');
      }
      hecho.push('archivos');
    } else if (step === 'contacts') {
      tick('Pasando contactos…');
      const r = src.platform === 'ios' ? await iosData.exportContacts(iosDir, work) : await androidData.exportContacts(src.serial, work);
      if (r.count) { avisos.push(await importContactsAndroid(dst.serial, r.file)); hecho.push(`${r.count} contactos`); } else avisos.push('El origen no tiene contactos guardados en el teléfono (pueden estar solo en la cuenta de Google o iCloud).');
    } else if (step === 'apps') {
      tick('Pasando apps…');
      const pkgs = await androidData.userPackages(src.serial);
      let ok = 0;
      for (const pkg of pkgs) {
        try {
          const dir = path.join(work, 'apps');
          const apps = require('./apps');
          const r = await apps.androidBackupApk(src.serial, pkg, dir);
          const files = fs.readdirSync(r.dir).map((f) => path.join(r.dir, f));
          await apps.androidInstall(dst.serial, files);
          ok++;
        } catch (e) { avisos.push(`${pkg}: ${e.message.split('\n')[0]}`); }
      }
      hecho.push(`${ok} de ${pkgs.length} apps (sin sus datos internos: Android no lo permite sin root)`);
    }
  }
  progress({ text: 'Migración completada.', percent: 100 });
  return { hecho, avisos, work };
}

module.exports = { plan, migrate };
