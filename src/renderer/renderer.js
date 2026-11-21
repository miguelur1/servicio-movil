'use strict';
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : String(c));
  return n;
};
const fmtBytes = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = Number(n); let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const STATE = { device: 'Conectado', unauthorized: 'Autoriza en el teléfono', offline: 'Sin conexión', fastboot: 'Fastboot', recovery: 'Recovery', sideload: 'Sideload', unpaired: 'Sin emparejar' };

let selected = null; // {platform, serial, state}
let lastKey = '';

async function refresh() {
  const r = await window.api.listDevices();
  if (!r.ok) return;
  const { devices } = r.data;
  const key = JSON.stringify(devices);
  if (key === lastKey) return;
  lastKey = key;
  const list = $('#devices'); list.replaceChildren();
  $('#empty').hidden = devices.length > 0;
  if (!devices.length) $('#helpBox').open = true;
  for (const d of devices) {
    const li = el('li', { class: selected && selected.serial === d.serial ? 'sel' : '', onclick: () => select(d) },
      el('div', {}, d.platform === 'ios' ? 'iPhone/iPad' : 'Android', el('span', { class: `badge ${d.state}` }, STATE[d.state] || d.state)),
      el('div', {}, d.model || '—'),
      el('div', { class: 'serial' }, d.serial));
    list.append(li);
  }
  if (selected && !devices.find((d) => d.serial === selected.serial)) { selected = null; $('#detail').replaceChildren(el('p', { class: 'muted' }, 'El dispositivo se desconectó.')); }
}

function card(k, v) { return el('div', { class: 'card' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v ?? '—')); }

// ── Trabajos con progreso ───────────────────────────────────────────────────
const progressHandlers = new Map();
window.api.onProgress((p) => { const h = progressHandlers.get(p.id); if (h) h(p); });
let jobSeq = 0;

/** Zona de estado: mensaje, barra de progreso y botón de cancelar. */
function statusBox() {
  const msg = el('p', {});
  const bar = el('i');
  const barBox = el('div', { class: 'bar', hidden: '' }, bar);
  const cancel = el('button', { class: 'ghost', hidden: '' }, 'Cancelar');
  const box = el('div', { class: 'status' }, msg, barBox, cancel);
  let running = false;
  return {
    box,
    get running() { return running; },
    async run(btn, fn, okText) {
      if (running) return;
      running = true;
      const id = `j${++jobSeq}`;
      document.querySelectorAll('#detail button.act').forEach((b) => { b.disabled = true; });
      msg.className = 'muted'; msg.textContent = 'Trabajando…';
      barBox.hidden = true; bar.style.width = '0%';
      cancel.hidden = false; cancel.onclick = () => window.api.cancelJob(id);
      progressHandlers.set(id, (p) => {
        if (p.text) msg.textContent = p.text;
        if (typeof p.percent === 'number') { barBox.hidden = false; bar.style.width = `${p.percent}%`; }
      });
      try {
        const r = await fn(id);
        if (!r.ok) { msg.className = 'err'; msg.textContent = r.error; } else if (r.data === null) { msg.className = 'muted'; msg.textContent = 'Cancelado.'; } else { msg.className = 'ok'; msg.textContent = okText(r.data); }
        return r;
      } finally {
        running = false; progressHandlers.delete(id); cancel.hidden = true;
        document.querySelectorAll('#detail button.act').forEach((b) => { b.disabled = false; });
      }
    },
    say(text, cls = 'muted') { msg.className = cls; msg.textContent = text; },
  };
}

function actionButton(label, onClick, ghost) {
  const b = el('button', { class: `act${ghost ? ' ghost' : ''}` }, label);
  b.addEventListener('click', () => onClick(b));
  return b;
}
const section = (title, ...kids) => el('div', { class: 'section' }, el('h4', {}, title), ...kids);
const note = (t) => el('p', { class: 'muted small' }, t);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

async function select(d) {
  selected = d; lastKey = ''; refresh();
  const det = $('#detail');
  det.replaceChildren(el('p', { class: 'muted' }, 'Leyendo información…'));
  const st = statusBox();

  if (d.state === 'fastboot') {
    const actions = el('div', { class: 'actions' });
    for (const [m, l] of [['system', 'Reiniciar'], ['bootloader', 'Reiniciar a bootloader'], ['recovery', 'Reiniciar a recovery']]) {
      actions.append(actionButton(l, (b) => st.run(b, () => window.api.reboot(d.serial, m, true), () => 'Orden enviada.'), m !== 'system'));
    }
    det.replaceChildren(el('h3', {}, 'Dispositivo en modo Fastboot'), el('div', { class: 'serial muted' }, d.serial), actions, st.box);
    return;
  }
  if (d.state !== 'device') {
    det.replaceChildren(el('h3', {}, STATE[d.state] || d.state), el('p', { class: 'muted' },
      d.platform === 'ios' ? 'Desbloquea el iPhone y pulsa «Confiar en este ordenador».' : 'Acepta la huella RSA de depuración USB en la pantalla del teléfono.'));
    return;
  }

  const r = await window.api.info(d.platform, d.serial);
  if (!r.ok) { det.replaceChildren(el('p', { class: 'err' }, r.error)); return; }
  const i = r.data;
  const model = i.name || i.model || d.model || d.serial;
  const ios = d.platform === 'ios';

  const tabs = [
    ['Información', () => infoTab(d, i, st)],
    ['Copia de seguridad', () => backupTab(d, model, st)],
    ['Fotos', () => photosTab(d, model, st)],
    ['Contactos y mensajes', () => contactsTab(d, model, st)],
    [ios ? 'Archivos de la copia' : 'Archivos', () => (ios ? iosFilesTab(d, st) : filesTab(d, st))],
  ];
  const body = el('div', { class: 'tabbody' });
  const bar = el('div', { class: 'tabs' });
  const show = (idx) => {
    if (st.running) return;
    bar.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === idx));
    st.say('');
    body.replaceChildren(tabs[idx][1]());
  };
  tabs.forEach(([label], idx) => { const b = el('button', { class: 'tab' }, label); b.addEventListener('click', () => show(idx)); bar.append(b); });
  det.replaceChildren(el('h3', {}, model), el('div', { class: 'serial muted' }, d.serial), bar, body, st.box);
  show(0);
}

function infoTab(d, i, st) {
  const s = i.storage;
  const usedBytes = s ? (s.usedBytes ?? (s.totalBytes - s.freeBytes)) : null;
  const used = s && s.totalBytes ? Math.round((usedBytes / s.totalBytes) * 100) : null;
  const cards = i.platform === 'ios' ? [
    card('Nombre', i.name), card('Modelo', i.model), card('Nº de modelo', i.modelNumber), card('iOS', `${i.iosVersion || '—'} (${i.buildId || '—'})`),
    card('Nº de serie', i.serialNumber), card('Activación (lectura)', i.activationState), card('CPU', i.cpu),
  ] : [
    card('Fabricante', i.manufacturer), card('Modelo', `${i.model || '—'} (${i.device || '—'})`), card('Android', `${i.androidVersion || '—'} · SDK ${i.sdk || '—'}`),
    card('Parche de seguridad', i.securityPatch), card('Build', i.buildId), card('Hardware / ABI', `${i.hardware || '—'} / ${i.abi || '—'}`),
    card('Bootloader', i.bootloaderLocked === null ? '—' : (i.bootloaderLocked ? 'Bloqueado' : 'Desbloqueado')), card('Verified boot', i.verifiedBoot),
  ];
  const b = i.battery || {};
  cards.push(card('Batería', `${b.level ?? '—'} %${b.status ? ' · ' + b.status : ''}${b.health ? ' · salud ' + b.health : ''}${b.temperatureC != null ? ' · ' + b.temperatureC + ' °C' : ''}`));
  const storageCard = card('Almacenamiento', s ? `${fmtBytes(usedBytes)} usados de ${fmtBytes(s.totalBytes)}` : '—');
  if (used !== null) { const fill = el('i'); fill.style.width = `${used}%`; storageCard.append(el('div', { class: 'bar' }, fill)); }
  cards.push(storageCard);

  const out = el('pre', { hidden: '' });
  const actions = el('div', { class: 'actions' });
  actions.append(actionButton('Captura de pantalla', (btn) => st.run(btn, () => window.api.screenshot(d.platform, d.serial), (f) => `Guardada en ${f}`)));
  actions.append(actionButton(d.platform === 'ios' ? 'Registro del sistema (10 s)' : 'Logcat (últimas 2000 líneas)', async (btn) => {
    const lr = await st.run(btn, () => window.api.logs(d.platform, d.serial), () => 'Registro cargado.');
    if (lr && lr.ok) { out.hidden = false; out.textContent = lr.data; }
  }, true));
  if (d.platform === 'android') {
    actions.append(actionButton('Instalar APK…', (btn) => st.run(btn, () => window.api.installApk(d.serial), (x) => (x ? 'APK instalado.' : 'Cancelado.')), true));
    for (const [m, l] of [['system', 'Reiniciar'], ['recovery', 'Reiniciar a recovery'], ['bootloader', 'Reiniciar a fastboot']]) {
      actions.append(actionButton(l, (btn) => st.run(btn, () => window.api.reboot(d.serial, m, false), () => 'Orden enviada.'), true));
    }
  }
  const extra = d.platform === 'ios' ? note('En iOS 17 o posterior la captura de pantalla necesita el modo desarrollador activado en el iPhone.') : null;
  return el('div', {}, el('div', { class: 'grid' }, cards), actions, extra, out);
}

function backupTab(d, model, st) {
  const ios = d.platform === 'ios';
  const apps = el('input', { type: 'checkbox', id: 'opt-apps' });
  const doBackup = actionButton('Hacer copia de seguridad', (btn) => st.run(btn, (id) => window.api.backup(id, d.platform, d.serial, { model, apps: apps.checked }), (x) => (ios
    ? `Copia completa guardada en ${x.dir}${x.encrypted ? ' (cifrada: solo se puede restaurar, no extraer datos).' : '.'}`
    : `Copia guardada en ${x.dest}: ${plural(x.carpetas.length, 'carpeta', 'carpetas')}, ${x.contactos ?? 0} contactos, ${x.sms ?? 0} SMS, ${plural(x.apps.length, 'app', 'apps')}.${x.avisos.length ? ` Avisos: ${x.avisos.join(' ')}` : ''}`)));
  const doRestore = actionButton('Restaurar una copia…', (btn) => st.run(btn, (id) => window.api.restore(id, d.platform, d.serial), (x) => (ios
    ? 'Restauración completada. El iPhone se está reiniciando.'
    : `Restaurado: ${plural(x.carpetas, 'carpeta', 'carpetas')} y ${plural(x.apps, 'app', 'apps')}. ${x.avisos.join(' ')}`)), true);
  return el('div', {},
    section('Copia de seguridad',
      ios ? note('Copia completa del iPhone, igual que iTunes: fotos, contactos, mensajes, WhatsApp, ajustes y datos de apps. Puede tardar bastante; deja el iPhone desbloqueado y conectado.')
        : note('Copia las carpetas del teléfono (DCIM, Pictures, Download, Music…), los contactos y los SMS. Android no permite copiar los datos internos de las apps sin root.'),
      ios ? null : el('label', { class: 'check' }, apps, ' Incluir las apps instaladas (APK)'),
      el('div', { class: 'actions' }, doBackup)),
    section('Restaurar',
      ios ? note('Restaura una copia en este iPhone. También sirve para pasar los datos de un iPhone antiguo a uno nuevo: elige la copia del antiguo. Hay que desactivar «Buscar mi iPhone» en el de destino.')
        : note('Vuelve a copiar las carpetas e instala las apps guardadas. También sirve para pasar los datos a otro Android.'),
      el('div', { class: 'actions' }, doRestore)));
}

function freshOption(d) {
  if (d.platform !== 'ios') return { node: null, get: () => false };
  const cb = el('input', { type: 'checkbox' });
  const label = el('label', { class: 'check' }, cb, ' Hacer una copia nueva antes (si no, se usa la última copia)');
  const info = note('Buscando copias de este iPhone…');
  window.api.iosBackupInfo(d.serial).then((r) => {
    if (r.ok && r.data) info.textContent = `Última copia: ${new Date(r.data.date).toLocaleString('es-ES')}.`;
    else { info.textContent = 'No hay copias de este iPhone: se hará una primero (puede tardar).'; cb.checked = true; cb.disabled = true; }
  });
  return { node: el('div', {}, info, label), get: () => cb.checked };
}

function photosTab(d, model, st) {
  const ios = d.platform === 'ios';
  const fresh = freshOption(d);
  const copy = actionButton('Copiar fotos y vídeos al PC', (btn) => st.run(btn, (id) => window.api.photos(id, d.platform, d.serial, { model, fresh: fresh.get() }),
    (x) => (ios ? `${plural(x.count, 'archivo copiado', 'archivos copiados')} en ${x.dest}.${x.note ? ` ${x.note}` : ''}` : `Fotos copiadas en ${x.dest}.`)));
  const kids = [section('Del teléfono al PC',
    ios ? note('Las fotos y vídeos del carrete se sacan de la copia de seguridad del iPhone, en su formato original (HEIC/JPG/MOV).') : note('Copia DCIM, Pictures y Movies.'),
    fresh.node, el('div', { class: 'actions' }, copy))];
  if (!ios) {
    kids.push(section('Del PC al teléfono', note('Las fotos se guardan en DCIM/ServicioMovil y aparecen en la galería.'),
      el('div', { class: 'actions' }, actionButton('Enviar fotos al teléfono…', (btn) => st.run(btn, (id) => window.api.sendPhotos(id, d.serial), (x) => `${plural(x.count, 'archivo enviado', 'archivos enviados')}.`), true))));
  } else {
    kids.push(note('Para pasar fotos a un iPhone, Apple solo permite hacerlo con una restauración de copia o con iCloud/Fotos.'));
  }
  return el('div', {}, ...kids);
}

function contactsTab(d, model, st) {
  const fresh = freshOption(d);
  return el('div', {},
    section('Contactos', note('Se exportan a un archivo .vcf que se puede importar en cualquier Android, iPhone, Gmail u Outlook.'), fresh.node,
      el('div', { class: 'actions' }, actionButton('Exportar contactos (.vcf)', (btn) => st.run(btn, (id) => window.api.contacts(id, d.platform, d.serial, { model, fresh: fresh.get() }), (x) => `${plural(x.count, 'contacto exportado', 'contactos exportados')} a ${x.file}`)))),
    section('Mensajes', note(d.platform === 'ios' ? 'SMS e iMessage a una hoja de cálculo (.csv). Los adjuntos aparecen como [adjunto].' : 'SMS a una hoja de cálculo (.csv). Algunos Android recientes no permiten leerlos desde el PC.'),
      el('div', { class: 'actions' }, actionButton('Exportar mensajes (.csv)', (btn) => st.run(btn, (id) => window.api.messages(id, d.platform, d.serial, { model, fresh: fresh.get() }), (x) => `${plural(x.count, 'mensaje exportado', 'mensajes exportados')} a ${x.file}`), true))));
}

function filesTab(d, st) {
  let cwd = '/sdcard';
  const crumb = el('div', { class: 'crumb' });
  const list = el('ul', { class: 'files' });
  const chosen = new Set();
  const load = async (dir) => {
    list.replaceChildren(el('li', { class: 'muted' }, 'Cargando…'));
    const r = await window.api.listFiles(d.serial, dir);
    if (!r.ok) { list.replaceChildren(el('li', { class: 'err' }, r.error)); return; }
    cwd = dir; chosen.clear();
    crumb.textContent = cwd;
    const rows = r.data.map((f) => {
      const cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', () => (cb.checked ? chosen.add(f.path) : chosen.delete(f.path)));
      const name = el('span', { class: f.dir ? 'dir' : '' }, `${f.dir ? '📁 ' : ''}${f.name}`);
      if (f.dir) name.addEventListener('click', () => load(f.path));
      return el('li', {}, cb, name, el('span', { class: 'muted' }, f.dir ? '' : fmtBytes(f.size)));
    });
    list.replaceChildren(...(rows.length ? rows : [el('li', { class: 'muted' }, 'Carpeta vacía')]));
  };
  const up = el('button', { class: 'ghost' }, '↑ Subir');
  up.addEventListener('click', () => { const p = cwd.replace(/\/[^/]+\/?$/, '') || '/'; load(p); });
  const actions = el('div', { class: 'actions' }, up,
    actionButton('Copiar seleccionados al PC', (btn) => (chosen.size ? st.run(btn, () => window.api.pullFiles(d.serial, [...chosen]), (x) => `Copiado en ${x}`) : st.say('Marca primero algún archivo o carpeta.'))),
    actionButton('Enviar archivos aquí…', (btn) => st.run(btn, () => window.api.pushFiles(d.serial, cwd), (n) => `${plural(n, 'archivo enviado', 'archivos enviados')}.`).then(() => load(cwd)), true));
  load(cwd);
  return el('div', {}, actions, crumb, list);
}

function iosFilesTab(d, st) {
  const input = el('input', { type: 'search', placeholder: 'Buscar en la copia (p. ej. WhatsApp, Notes, .jpg)…', class: 'search' });
  const list = el('ul', { class: 'files' });
  const chosen = new Set();
  const search = async () => {
    list.replaceChildren(el('li', { class: 'muted' }, 'Buscando…'));
    const r = await window.api.iosBrowse(d.serial, input.value.trim());
    chosen.clear();
    if (!r.ok) { list.replaceChildren(el('li', { class: 'err' }, r.error)); return; }
    list.replaceChildren(...(r.data.length ? r.data.map((f) => {
      const cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', () => (cb.checked ? chosen.add(f.id) : chosen.delete(f.id)));
      return el('li', {}, cb, el('span', {}, f.rel), el('span', { class: 'muted' }, f.domain));
    }) : [el('li', { class: 'muted' }, 'Sin resultados')]));
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  return el('div', {},
    note('iOS no deja explorar el teléfono como un disco: aquí se exploran los archivos de la última copia de seguridad (fotos, WhatsApp, notas, datos de apps…). Muestra hasta 500 resultados.'),
    el('div', { class: 'actions' }, input, actionButton('Buscar', () => search(), true),
      actionButton('Extraer seleccionados', (btn) => (chosen.size ? st.run(btn, () => window.api.iosExtract(d.serial, [...chosen]), (x) => `${plural(x.count, 'archivo extraído', 'archivos extraídos')} en ${x.dest}`) : st.say('Marca primero algún archivo.')))),
    list);
}

async function loadTools() {
  const r = await window.api.toolsStatus();
  if (!r.ok) return;
  $('#tools').replaceChildren(...r.data.map((t) => el('li', { class: t.ok ? 'ok' : 'err', title: t.error || t.path }, `${t.ok ? '✓' : '✗'} ${t.name}`)));
  if (r.data.some((t) => !t.ok)) $('#toolsBox').open = true;
}

window.api.onUpdate((s) => {
  const u = $('#update');
  const text = { checking: null, none: null, dev: null, available: `Descargando versión ${s.version}…`, downloading: `Actualización ${s.percent}%`, ready: `Versión ${s.version} lista`, error: null }[s.status];
  u.hidden = !text; u.replaceChildren(text || '');
  if (s.status === 'ready') u.append(' ', el('button', { onclick: () => window.api.installUpdate() }, 'Reiniciar y actualizar'));
});

window.api.platform().then((r) => { if (r.ok && r.data !== 'win32') $('#pixelDriver').hidden = true; });
$('#installDriver').addEventListener('click', async () => {
  const b = $('#installDriver'); const m = $('#driverMsg');
  b.disabled = true; m.className = 'muted'; m.textContent = ' Acepta el aviso de administrador de Windows…';
  const r = await window.api.installGoogleDriver();
  b.disabled = false; m.className = r.ok ? 'ok' : 'err'; m.textContent = ` ${r.ok ? r.data : r.error}`;
});

$('#refresh').addEventListener('click', () => { lastKey = ''; refresh(); });
window.api.version().then((r) => { if (r.ok) $('#version').textContent = `v${r.data}`; });
loadTools();
refresh();
setInterval(refresh, 3000);
