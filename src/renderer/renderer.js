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
let lastDevices = [];

async function refresh() {
  const r = await window.api.listDevices();
  if (!r.ok) return;
  const { devices } = r.data;
  lastDevices = devices;
  const key = JSON.stringify(devices);
  if (key === lastKey) return;
  lastKey = key;
  const list = $('#devices'); list.replaceChildren();
  $('#empty').hidden = devices.length > 0;
  if (!devices.length) $('#helpBox').open = true;
  for (const d of devices) {
    const li = el('li', { class: selected && selected.serial === d.serial ? 'sel' : '', onclick: () => select(d) },
      el('div', {}, d.platform === 'ios' ? 'iPhone/iPad' : 'Android', el('span', { class: `badge ${d.state}` }, STATE[d.state] || d.state)),
      el('div', {}, d.marketName || d.model || '—'),
      d.marketName && d.model && d.marketName !== d.model ? el('div', { class: 'muted small' }, d.model) : null,
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
/** replaceChildren ignorando null/undefined (si no, el DOM escribe «null»). */
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined));
const note = (t) => el('p', { class: 'muted small' }, t);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// ── Imagen del dispositivo ──────────────────────────────────────────────────
function deviceArt(d, info, title) {
  const name = info.marketName || info.model || d.model || d.serial;
  const wrap = el('div', { class: 'art' });
  const frame = el('div', { class: 'phone' });
  const screen = el('div', { class: 'screen' });
  const img = el('img', { alt: '' });
  img.hidden = true;
  const clock = el('div', { class: 'clock' }, new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
  screen.append(img, clock);
  frame.append(screen);
  const photo = el('img', { class: 'photo', alt: name }); photo.hidden = true;
  const caption = el('div', { class: 'artcap muted small' }, '');
  const btnShot = el('button', { class: 'ghost mini' }, '↻ Pantalla');
  const btnPhoto = el('button', { class: 'ghost mini' }, 'Poner foto');
  const btnDel = el('button', { class: 'ghost mini' }, 'Quitar foto'); btnDel.hidden = true;
  const showPhoto = (url) => {
    photo.hidden = !url; frame.hidden = !!url; btnDel.hidden = !url; btnShot.hidden = !!url;
    if (url) photo.src = url;
  };
  const loadScreen = async () => {
    btnShot.disabled = true; caption.textContent = 'Leyendo pantalla…';
    const r = await window.api.artPreview(d.platform, d.serial);
    btnShot.disabled = false;
    if (r.ok && r.data) {
      img.onload = () => { img.hidden = false; clock.hidden = true; caption.textContent = 'Pantalla en directo'; };
      img.onerror = () => { caption.textContent = ''; };
      img.src = r.data;
    } else caption.textContent = d.platform === 'ios' ? 'Pantalla no disponible (iOS 17+: modo desarrollador)' : 'Pantalla no disponible';
  };
  btnShot.addEventListener('click', loadScreen);
  btnPhoto.addEventListener('click', async () => { const r = await window.api.artSetPhoto(name); if (r.ok && r.data) showPhoto(r.data); });
  btnDel.addEventListener('click', async () => { await window.api.artRemovePhoto(name); showPhoto(null); loadScreen(); });
  window.api.artKind({ platform: info.platform, model: info.model, marketName: info.marketName }).then((r) => { frame.classList.add(r.ok ? r.data : 'android'); });
  window.api.artPhoto(name).then((r) => { if (r.ok && r.data) showPhoto(r.data); else loadScreen(); });
  wrap.append(frame, photo, caption, el('div', { class: 'artbtns' }, btnShot, btnPhoto, btnDel));
  return wrap;
}

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
    det.replaceChildren(el('h3', {}, 'Dispositivo en modo Fastboot'), el('div', { class: 'serial muted' }, d.serial), actions, fastbootWipeSection(d, st), st.box);
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
  const title = i.platform === 'ios' ? (i.name && i.marketName ? `${i.name} · ${i.marketName}` : (i.marketName || model)) : (i.marketName || model);
  const ios = d.platform === 'ios';

  const tabs = [
    ['Información', () => infoTab(d, i, st)],
    ['Diagnóstico', () => diagTab(d, i, st)],
    ['Apps', () => appsTab(d, st)],
    ['Copia de seguridad', () => backupTab(d, model, st)],
    ['Fotos', () => photosTab(d, model, st)],
    ['Contactos y mensajes', () => contactsTab(d, model, st)],
    [ios ? 'Archivos de la copia' : 'Archivos', () => (ios ? iosFilesTab(d, st) : filesTab(d, st))],
    ['Reparación', () => repairTab(d, i.marketName || i.model || d.model || d.serial, st)],
    ['Restablecer', () => resetTab(d, st)],
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
  const head = el('div', { class: 'devhead' }, deviceArt(d, i, title),
    el('div', { class: 'devtitle' }, el('h3', {}, title), el('div', { class: 'serial muted' }, `${i.model || ''} · ${d.serial}`),
      el('div', { class: 'muted small' }, i.platform === 'ios' ? `iOS ${i.iosVersion || '—'}` : `Android ${i.androidVersion || '—'}`, i.battery && i.battery.level != null ? ` · batería ${i.battery.level} %` : '')));
  det.replaceChildren(head, bar, body, st.box);
  show(0);
}

// ── Reparación: guías de iFixit, búsquedas y biblioteca propia ──────────────
const DIFF = { 'Very easy': 'Muy fácil', Easy: 'Fácil', Moderate: 'Moderada', Difficult: 'Difícil', 'Very difficult': 'Muy difícil' };
// [id, nombre, término de búsqueda en inglés, término en español]
const REPAIRS = [
  ['screen', 'Pantalla', 'screen replacement', 'cambiar pantalla'], ['battery', 'Batería', 'battery replacement', 'cambiar batería'],
  ['charging', 'Conector de carga', 'charging port replacement', 'cambiar conector de carga'], ['back', 'Tapa trasera', 'back glass replacement', 'cambiar tapa trasera'],
  ['rear_camera', 'Cámara trasera', 'rear camera replacement', 'cambiar cámara trasera'], ['front_camera', 'Cámara frontal', 'front camera replacement', 'cambiar cámara frontal'],
  ['faceid', 'Face ID / sensores frontales', 'face id replacement', 'face id reparación'], ['fingerprint', 'Lector de huellas', 'fingerprint sensor replacement', 'cambiar lector de huellas'],
  ['speaker', 'Altavoz', 'loudspeaker replacement', 'cambiar altavoz'], ['earpiece', 'Auricular (llamadas)', 'earpiece speaker replacement', 'cambiar auricular'],
  ['microphone', 'Micrófono', 'microphone replacement', 'cambiar micrófono'], ['buttons', 'Botones', 'power button replacement', 'cambiar botón encendido'],
  ['vibrator', 'Vibrador', 'vibrator replacement', 'cambiar vibrador'], ['sim', 'SIM y antenas', 'sim card reader replacement', 'cambiar lector sim'],
  ['board', 'Placa base', 'motherboard replacement', 'cambiar placa base'], ['other', 'Otras reparaciones', 'repair', 'reparación'],
];
const REPAIR_NAME = Object.fromEntries(REPAIRS.map(([id, n]) => [id, n]));
const link = (label, url, cls = 'linkbtn') => el('button', { class: cls, onclick: () => window.api.openUrl(url) }, label);

// Resultados del diagnóstico por dispositivo, para el informe y las reparaciones recomendadas.
const diagCache = new Map();
const cacheFor = (serial) => { if (!diagCache.has(serial)) diagCache.set(serial, {}); return diagCache.get(serial); };

/** Reparaciones recomendadas a partir del diagnóstico: { tipo: [motivos] } */
function recommend(c) {
  const out = {};
  const add = (k, why) => { (out[k] = out[k] || []); if (!out[k].includes(why)) out[k].push(why); };
  const b = c.battery;
  if (b && b.healthPercent != null && b.healthPercent < 85) add('battery', `salud de la batería ${b.healthPercent} %`);
  for (const p of c.components || []) {
    if (p.status !== 'bad' && p.status !== 'warn') continue;
    const map = { touch: 'screen', display: 'screen', fingerprint: 'fingerprint', charging: 'charging', modem: 'board', storage: 'board', proximity: 'faceid' };
    if (p.id === 'camera') { add(/0 frontal/.test(p.detail) ? 'front_camera' : 'rear_camera', `cámaras: ${p.detail}`); continue; }
    if (p.id === 'sensors' && /proximidad/.test(p.detail)) { add('screen', 'sensor de proximidad (parte superior de la pantalla)'); continue; }
    if (p.id === 'sim' && p.status === 'bad') { add('sim', p.detail); continue; }
    if ((p.id === 'wifi' || p.id === 'bluetooth') && p.status === 'bad') { add('board', `${p.name}: ${p.detail}`); continue; }
    if (p.id === 'panics' && /flex de carga|Micr/i.test(p.detail)) { add('charging', p.detail); continue; }
    if (p.id === 'panics' && /bater/i.test(p.detail)) { add('battery', p.detail); continue; }
    if (p.id === 'panics' && /Face ID|SEP/i.test(p.detail)) { add('faceid', p.detail); continue; }
    if (p.id === 'panics' && p.status === 'bad') { add('board', p.detail); continue; }
    if (map[p.id] && p.status === 'bad') add(map[p.id], `${p.name}: ${p.detail}`);
  }
  const fmap = { moisture: 'charging', charging: 'charging', battery: 'battery', thermal: 'battery', camera: 'rear_camera', touch: 'screen', display: 'screen', storage_hw: 'board', sim: 'sim', modem: 'board', fingerprint: 'fingerprint', audio: 'speaker' };
  for (const f of (c.analysis && c.analysis.findings) || []) if (fmap[f.id]) add(fmap[f.id], `registro: ${f.title.toLowerCase()}`);
  return out;
}

function repairTab(d, name, st) {
  const cache = cacheFor(d.serial);
  const wrap = el('div', {});
  const head = el('div', {}, el('p', { class: 'muted' }, `Buscando las guías de «${name}»…`));
  const picker = el('div', { class: 'repairs' });
  const detail = el('div', { class: 'repairdetail' });
  let device = null; let selected = null;

  const guideRow = (g) => el('li', { onclick: () => openGuide(g.id) },
    g.image ? el('img', { src: g.image, alt: '' }) : el('div', { class: 'noimg' }),
    el('div', {}, el('div', {}, g.title), el('div', { class: 'muted small' }, [g.type === 'replacement' ? 'Sustitución' : null, DIFF[g.difficulty] || g.difficulty, g.minutes ? `${g.minutes} min` : null].filter(Boolean).join(' · '))));

  const choose = async (kind) => {
    selected = kind;
    picker.querySelectorAll('.repair').forEach((x) => x.classList.toggle('on', x.dataset.kind === kind));
    const [, label, en, es] = REPAIRS.find((r) => r[0] === kind);
    const gs = device && device.found ? device.guides.filter((g) => g.kind === kind) : [];
    const why = recommend(cache)[kind];
    if (!gs.length) {
      const r = await window.api.repairSearch(name, es, en);
      put(detail, el('h4', {}, label), why ? el('p', { class: 'warnt small' }, `Recomendada por el diagnóstico: ${why.join('; ')}.`) : null,
        note(`iFixit no tiene una guía de «${label.toLowerCase()}» para este modelo. Búscala en:`),
        el('div', { class: 'actions' }, (r.ok ? r.data : []).map((l) => link(l.label, l.url, 'act ghost'))));
      return;
    }
    put(detail, el('h4', {}, `${label} · ${plural(gs.length, 'guía', 'guías')}`), why ? el('p', { class: 'warnt small' }, `Recomendada por el diagnóstico: ${why.join('; ')}.`) : null,
      el('ul', { class: 'guides' }, gs.map(guideRow)));
    if (gs.length === 1 || gs.filter((g) => g.type === 'replacement').length === 1) openGuide((gs.find((g) => g.type === 'replacement') || gs[0]).id);
  };

  // Abre sola la primera reparación recomendada que tenga guía (solo si aún no se ha elegido ninguna).
  const autoPick = () => {
    if (selected || !device || !device.found) return;
    const order = REPAIRS.map(([id]) => id);
    const rec = Object.keys(recommend(cache)).sort((x, y) => order.indexOf(x) - order.indexOf(y)).find((kk) => device.guides.some((g) => g.kind === kk));
    if (rec) choose(rec);
  };

  const renderPicker = () => {
    const rec = recommend(cache);
    const counts = {};
    for (const g of (device && device.guides) || []) counts[g.kind] = (counts[g.kind] || 0) + 1;
    const items = REPAIRS.filter(([id]) => (id !== 'other' || counts.other) && (id !== 'faceid' || d.platform === 'ios' || counts.faceid))
      .sort((x, y) => (rec[y[0]] ? 1 : 0) - (rec[x[0]] ? 1 : 0) || ((counts[y[0]] ? 1 : 0) - (counts[x[0]] ? 1 : 0)));
    put(picker, items.map(([id, label]) => {
      const b = el('button', { class: `repair${rec[id] ? ' rec' : ''}${selected === id ? ' on' : ''}`, onclick: () => choose(id) },
        el('div', { class: 'rname' }, label),
        el('div', { class: 'muted small' }, counts[id] ? plural(counts[id], 'guía con fotos', 'guías con fotos') : 'buscar en internet'),
        rec[id] ? el('div', { class: 'rwhy' }, `Recomendada: ${rec[id][0].split('.')[0].slice(0, 80)}`) : null);
      b.dataset.kind = id;
      return b;
    }));
  };

  const openGuide = async (id) => {
    const view = el('div', { class: 'guideview' }, el('p', { class: 'muted' }, 'Cargando la guía…'));
    put(detail, el('button', { class: 'ghost', onclick: () => choose(selected) }, '← Volver a las guías'), view);
    const r = await window.api.repairGuide(id);
    if (!r.ok) { put(view, el('p', { class: 'err' }, r.error)); return; }
    const g = r.data;
    let k = 0; let all = false;
    const counter = el('span', { class: 'muted' });
    const stepBox = el('div', {});
    const dots = el('div', { class: 'dots' }, g.steps.map((_, n) => { const x = el('i', { onclick: () => { k = n; draw(); } }); return x; }));
    const prev = el('button', { class: 'ghost', onclick: () => { if (k > 0) { k--; draw(); } } }, '← Anterior');
    const next = el('button', { class: 'act', onclick: () => { if (k < g.steps.length - 1) { k++; draw(); } } }, 'Siguiente →');
    const mode = el('button', { class: 'ghost small-btn', onclick: () => { all = !all; draw(); } }, 'Ver todos los pasos');
    const stepEl = (s, n) => el('div', { class: 'step' },
      el('h5', {}, `Paso ${n + 1} de ${g.steps.length}${s.title ? ` · ${s.title}` : ''}`),
      el('div', { class: 'stepgrid' },
        el('div', { class: 'stepimgs' }, s.images.map((u) => el('img', { src: u, alt: '', onclick: () => window.api.openUrl(u) }))),
        el('ul', {}, s.lines.map((l) => { const li = el('li', { class: l.kind }, l.kind === 'caution' ? '⚠ ' : l.kind === 'note' ? 'ℹ ' : '', l.text); li.style.marginLeft = `${l.level * 16}px`; return li; }))));
    const draw = () => {
      mode.textContent = all ? 'Ver paso a paso' : 'Ver todos los pasos';
      prev.hidden = all; next.hidden = all; counter.hidden = all; dots.hidden = all;
      if (all) { put(stepBox, g.steps.map(stepEl)); return; }
      put(stepBox, g.steps.length ? stepEl(g.steps[k], k) : note('Esta guía no tiene pasos.'));
      counter.textContent = `Paso ${k + 1} de ${g.steps.length}`;
      prev.disabled = k === 0; next.disabled = k === g.steps.length - 1;
      dots.querySelectorAll('i').forEach((x, n) => x.classList.toggle('on', n === k));
    };
    put(view,
      el('h3', {}, g.title),
      el('p', { class: 'muted small' }, [DIFF[g.difficulty] || g.difficulty, g.minutes ? `hasta ${g.minutes} min` : null, `${g.steps.length} pasos`, g.langid && g.langid !== 'es' ? 'en inglés (no hay traducción)' : null].filter(Boolean).join(' · ')),
      g.intro ? el('p', {}, g.intro) : null,
      el('div', { class: 'tp' },
        g.tools.length ? el('div', {}, el('b', {}, 'Herramientas'), el('ul', {}, g.tools.map((t) => el('li', {}, t.name)))) : null,
        g.parts.length ? el('div', {}, el('b', {}, 'Piezas'), el('ul', {}, g.parts.map((p) => el('li', {}, `${p.quantity} × ${p.name}`)))) : null),
      el('div', { class: 'stepnav' }, prev, counter, next, mode), dots, stepBox,
      el('p', { class: 'muted small' }, 'Contenido de iFixit con licencia CC BY-NC-SA. ', link('Abrir la guía original', g.url)));
    draw();
  };

  // Esquemas, manuales y biblioteca (secundario)
  const linksBox = el('div', { class: 'actions' });
  const lib = el('div', {});
  const sitesInput = el('textarea', { class: 'search wide', rows: '3', placeholder: 'Un dominio por línea, p. ej. foro-de-reparaciones.com' });
  const loadLinks = () => window.api.repairLinks(name).then((r) => { if (r.ok) put(linksBox, r.data.map((l) => link(l.label, l.url, 'act ghost'))); });
  const loadLib = () => window.api.libraryList(name).then((r) => {
    if (!r.ok) { put(lib, el('p', { class: 'err' }, r.error)); return; }
    const files = r.data.files;
    put(lib, files.length
      ? el('ul', { class: 'files' }, files.map((f) => el('li', {}, '📄', el('span', { class: 'dir', onclick: () => window.api.libraryOpen(name, f.name) }, f.name), el('span', { class: 'muted small' }, fmtBytes(f.size)))))
      : note('Aún no tienes documentos para este modelo. Añade aquí tus esquemas, manuales o fotos de placa y aparecerán solos cada vez que conectes este modelo.'));
  });
  const docsBox = el('div', {});
  const extras = el('details', { class: 'section' }, el('summary', {}, el('b', {}, 'Esquemas, manuales oficiales y tu biblioteca')),
    el('h5', {}, 'Búsquedas y manuales'), linksBox,
    el('details', {}, el('summary', { class: 'muted small' }, 'Tus sitios de esquemas'), sitesInput,
      actionButton('Guardar sitios', (btn) => st.run(btn, () => window.api.settingsSet({ schematicSites: sitesInput.value.split(/\s+/) }), (x) => { sitesInput.value = x.schematicSites.join('\n'); loadLinks(); return `Guardados ${plural(x.schematicSites.length, 'sitio', 'sitios')}.`; }), true)),
    docsBox,
    el('h5', {}, 'Tu biblioteca para este modelo'), lib,
    el('div', { class: 'actions' },
      actionButton('Añadir documentos…', (btn) => st.run(btn, () => window.api.libraryAdd(name), (x) => { loadLib(); return x ? 'Documentos añadidos.' : 'Cancelado.'; })),
      actionButton('Abrir carpeta', (btn) => st.run(btn, () => window.api.libraryFolder(name), (dir) => `Carpeta: ${dir}`), true)),
    note('Los esquemas eléctricos de los fabricantes no son públicos: la app busca en los sitios que tú indiques y abre los resultados en el navegador, sin descargar nada por su cuenta.'));

  put(wrap, head, section('¿Qué hay que reparar?', note('Elige la reparación y te muestro la guía paso a paso con fotos. Las marcadas en naranja las recomienda el diagnóstico.'), picker, detail), extras);
  renderPicker();

  window.api.repairDevice(name).then((r) => {
    if (!r.ok) { put(head, el('p', { class: 'err' }, `No se pudo consultar iFixit: ${r.error}`), note('Comprueba la conexión a internet.')); return; }
    device = r.data;
    if (!device.found) { put(head, note(`iFixit no tiene una página para «${name}». Las reparaciones te llevan a búsquedas en internet.`)); renderPicker(); return; }
    put(head, el('div', { class: 'ifxhead' },
      device.image ? el('img', { src: device.image, alt: '', class: 'ifximg' }) : null,
      el('div', {}, el('h4', {}, device.title), device.description ? el('p', { class: 'muted small' }, device.description) : null,
        el('div', { class: 'actions' }, link('Problemas típicos y soluciones', device.troubleshootingUrl, 'act ghost'), link('Preguntas y respuestas', device.answersUrl, 'act ghost')))));
    if (device.documents.length) put(docsBox, el('h5', {}, 'Documentos públicos en iFixit'), el('ul', { class: 'files' }, device.documents.map((x) => el('li', {}, '📄', el('span', { class: 'dir', onclick: () => window.api.openUrl(x.url) }, x.title), el('span', {})))));
    renderPicker(); autoPick();
  });
  // Si aún no se ha hecho el diagnóstico, se lee ahora (solo lectura) para recomendar reparaciones.
  if (!cache.components) window.api.components(d.platform, d.serial).then((r) => { if (r.ok) { cache.components = r.data; renderPicker(); autoPick(); } });
  if (!cache.battery) window.api.battery(d.platform, d.serial).then((r) => { if (r.ok) { cache.battery = r.data; renderPicker(); autoPick(); } });
  window.api.settingsGet().then((r) => { if (r.ok) sitesInput.value = r.data.schematicSites.join('\n'); });
  loadLinks(); loadLib();
  return wrap;
}

// ── Restablecer de fábrica ────────────────────────────────────────────────────
/** Botón que solo se activa al escribir BORRAR. */
function confirmButton(label, onRun) {
  const input = el('input', { type: 'text', class: 'search confirm', placeholder: 'Escribe BORRAR' });
  const btn = actionButton(label, (b) => onRun(b, input.value));
  btn.classList.add('dangerbtn'); btn.disabled = true;
  input.addEventListener('input', () => { btn.disabled = input.value.trim().toUpperCase() !== 'BORRAR'; });
  return el('div', { class: 'actions' }, input, btn);
}
const resetWarn = () => el('div', { class: 'danger-box' }, el('b', {}, 'Esto borra todo el teléfono: fotos, mensajes, apps y cuentas. No se puede deshacer.'),
  el('div', { class: 'small' }, 'Haz antes la copia en la pestaña «Copia de seguridad» y comprueba que el cliente conoce su cuenta y su contraseña.'));

function resetTab(d, st) {
  if (d.platform === 'ios') {
    return el('div', {}, resetWarn(),
      section('1 · Bloqueo de activación (Buscar mi iPhone)',
        note('Si «Buscar» está activado, después de restaurar el iPhone pedirá el Apple ID y la contraseña del cliente. Desactívalo antes en Ajustes › [nombre del cliente] › Buscar › Buscar mi iPhone, o asegúrate de que el cliente tiene su Apple ID a mano.')),
      section('2 · Opción recomendada: desde el propio iPhone',
        el('ol', { class: 'help' }, el('li', {}, 'Ajustes › General › Transferir o restablecer el iPhone.'), el('li', {}, 'Pulsa «Borrar contenidos y ajustes» y confirma con el código del iPhone.')),
        note('Es la forma más rápida y no necesita descargar iOS.')),
      section('3 · Restaurar con el ordenador (si el iPhone no arranca o no responde)',
        el('ol', { class: 'help' },
          el('li', {}, 'Pon el iPhone en modo recuperación con el botón de abajo.'),
          el('li', {}, 'Abre Dispositivos Apple (o iTunes) en este PC: aparecerá el aviso de un iPhone en modo recuperación.'),
          el('li', {}, 'Pulsa «Restaurar». Descarga el iOS oficial de Apple y deja el iPhone como nuevo.')),
        confirmButton('Poner en modo recuperación', (b, v) => st.run(b, () => window.api.resetIosRecovery(d.serial, v), () => 'El iPhone se ha reiniciado en modo recuperación. Ahora restaura desde Dispositivos Apple o iTunes.')),
        el('div', { class: 'actions' }, link('Guía oficial de Apple', 'https://support.apple.com/es-es/HT201252', 'act ghost'), link('Descargar Dispositivos Apple', 'https://apps.microsoft.com/search?query=Apple%20Devices', 'act ghost'))));
  }
  const acc = el('div', {}, note('Comprobando cuentas…'));
  window.api.resetCheck(d.serial).then((r) => {
    if (!r.ok) { put(acc, el('p', { class: 'err' }, r.error)); return; }
    const g = r.data.googleAccounts;
    put(acc, g.length
      ? el('div', {}, el('p', { class: 'warnt' }, `Cuenta de Google en el teléfono: ${g.join(', ')}.`),
        note('Si se borra desde recovery o fastboot con la cuenta puesta, al arrancar pedirá esa cuenta (protección FRP). Quítala antes en Ajustes › Cuentas con la contraseña del cliente, o restablece desde Ajustes, o asegúrate de que el cliente la conoce.'),
        el('div', { class: 'actions' }, actionButton('Abrir Cuentas en el teléfono', (b) => st.run(b, () => window.api.resetOpenAccounts(d.serial), () => 'Ajustes › Cuentas abierto en el teléfono.'), true)))
      : el('p', { class: 'ok' }, 'No hay cuentas de Google: tras el borrado no pedirá cuenta.'),
    r.data.bootloaderUnlocked ? note('El bootloader está desbloqueado: también puedes borrar desde el modo fastboot.') : null);
  });
  return el('div', {}, resetWarn(),
    section('1 · Cuenta de Google (protección FRP)', acc),
    section('2 · Opción recomendada: desde Ajustes del teléfono',
      note('Abre en el teléfono la pantalla oficial «Borrar todos los datos». El cliente (o tú con su código) confirma allí.'),
      el('div', { class: 'actions' }, actionButton('Abrir «Borrar todos los datos» en el teléfono', (b) => st.run(b, () => window.api.resetOpenScreen(d.serial), (x) => (x === 'settings' ? 'Ajustes abierto: ve a Sistema › Opciones de recuperación › Borrar todos los datos.' : 'Pantalla de restablecimiento abierta en el teléfono.'))))),
    section('3 · Desde recovery (si el teléfono no arranca bien o no se puede usar)',
      el('ol', { class: 'help' },
        el('li', {}, 'Pulsa «Reiniciar a recovery».'),
        el('li', {}, 'En el teléfono, muévete con los botones de volumen hasta «Wipe data / factory reset» y confirma con el botón de encendido.'),
        el('li', {}, 'Al terminar elige «Reboot system now».')),
      el('div', { class: 'actions' }, actionButton('Reiniciar a recovery', (b) => st.run(b, () => window.api.resetRecovery(d.serial), () => 'El teléfono se está reiniciando a recovery.'), true)),
      note('Si se queda en «No command», mantén encendido y pulsa una vez volumen arriba para ver el menú.')));
}

function fastbootWipeSection(d, st) {
  const box = el('div', {}, note('Comprobando el bootloader…'));
  window.api.resetFastbootState(d.serial).then((r) => {
    const unlocked = r.ok && r.data === true;
    put(box, unlocked
      ? el('div', {}, resetWarn(), confirmButton('Borrar datos (fastboot -w)', (b, v) => st.run(b, () => window.api.resetFastbootWipe(d.serial, v), () => 'Datos borrados. El teléfono se está reiniciando.')))
      : note(r.ok && r.data === false ? 'Bootloader bloqueado: el borrado por fastboot no está permitido. Usa recovery o Ajustes del teléfono.' : 'No se pudo leer el estado del bootloader.'));
  });
  return section('Restablecer de fábrica', box);
}

function infoTab(d, i, st) {
  const s = i.storage;
  const usedBytes = s ? (s.usedBytes ?? (s.totalBytes - s.freeBytes)) : null;
  const used = s && s.totalBytes ? Math.round((usedBytes / s.totalBytes) * 100) : null;
  const cards = i.platform === 'ios' ? [
    card('Dispositivo', i.marketName), card('Nombre', i.name), card('Modelo', i.model), card('Nº de modelo', i.modelNumber), card('iOS', `${i.iosVersion || '—'} (${i.buildId || '—'})`),
    card('Nº de serie', i.serialNumber), card('Activación (lectura)', i.activationState), card('CPU', i.cpu),
  ] : [
    card('Dispositivo', i.marketName), card('Fabricante', i.manufacturer), card('Modelo', `${i.model || '—'} (${i.device || '—'})`), card('Android', `${i.androidVersion || '—'} · SDK ${i.sdk || '—'}`),
    card('Parche de seguridad', i.securityPatch), card('Build', i.buildId), card('Hardware / ABI', `${i.hardware || '—'} / ${i.abi || '—'}`),
    card('Bootloader', i.bootloaderLocked === null ? '—' : (i.bootloaderLocked ? 'Bloqueado' : 'Desbloqueado')), card('Verified boot', i.verifiedBoot),
  ];
  const b = i.battery || {};
  cards.push(card('Batería', `${b.level ?? '—'} %${b.status ? ' · ' + b.status : ''}${b.health ? ' · salud ' + b.health : ''}${b.temperatureC != null ? ' · ' + b.temperatureC + ' °C' : ''}`));
  const storageCard = card('Almacenamiento', s ? `${fmtBytes(usedBytes)} usados de ${fmtBytes(s.totalBytes)}` : '—');
  if (used !== null) { const fill = el('i'); fill.style.width = `${used}%`; storageCard.append(el('div', { class: 'bar' }, fill)); }
  cards.push(storageCard);

  const actions = el('div', { class: 'actions' });
  actions.append(actionButton('Captura de pantalla', (btn) => st.run(btn, () => window.api.screenshot(d.platform, d.serial), (f) => `Guardada en ${f}`)));
  const logs = logPanel(d, st);
  actions.append(actionButton(logs.label, logs.run, true));
  if (d.platform === 'android') {
    actions.append(actionButton('Instalar APK…', (btn) => st.run(btn, () => window.api.installApk(d.serial), (x) => (x ? 'APK instalado.' : 'Cancelado.')), true));
    for (const [m, l] of [['system', 'Reiniciar'], ['recovery', 'Reiniciar a recovery'], ['bootloader', 'Reiniciar a fastboot']]) {
      actions.append(actionButton(l, (btn) => st.run(btn, () => window.api.reboot(d.serial, m, false), () => 'Orden enviada.'), true));
    }
  }
  const extra = d.platform === 'ios' ? note('En iOS 17 o posterior la captura de pantalla necesita el modo desarrollador activado en el iPhone.') : null;
  return el('div', {}, el('div', { class: 'grid' }, cards), actions, extra, logs.box);
}

const STATUS = { ok: ['ok', 'OK'], warn: ['warnt', 'Revisar'], bad: ['err', 'Fallo'], info: ['muted', 'Prueba manual'] };

function componentsSection(d, st) {
  const grid = el('div', { class: 'grid' }, el('p', { class: 'muted' }, 'Comprobando las piezas…'));
  const summary = el('p', {});
  const load = () => window.api.components(d.platform, d.serial).then((r) => {
    if (!r.ok) { put(grid, el('p', { class: 'err' }, r.error)); return; }
    cacheFor(d.serial).components = r.data;
    put(grid, r.data.map((c) => {
      const [cls, label] = STATUS[c.status] || STATUS.info;
      return el('div', { class: `card comp ${c.status}` }, el('div', { class: 'k' }, c.name, el('span', { class: `pill ${cls}` }, label)), el('div', { class: 'v small' }, c.detail));
    }));
    const bad = r.data.filter((c) => c.status === 'bad'); const warn = r.data.filter((c) => c.status === 'warn');
    summary.className = bad.length ? 'err' : warn.length ? 'warnt' : 'ok';
    summary.textContent = bad.length ? `Fallo en: ${bad.map((c) => c.name).join(', ')}.` : warn.length ? `Revisar: ${warn.map((c) => c.name).join(', ')}.` : 'Todas las piezas que se pueden leer por cable responden bien.';
  });
  load();
  return section('Piezas del teléfono', summary, grid,
    el('div', { class: 'actions' }, actionButton('Volver a comprobar', () => { put(grid, el('p', { class: 'muted' }, 'Comprobando las piezas…')); summary.textContent = ''; load(); }, true)),
    note(d.platform === 'ios' ? 'En iPhone, Apple solo deja leer por cable el módem, la SIM, el Wi-Fi, el Bluetooth y los reinicios. El resto se prueba en el propio teléfono.' : 'Lectura sin tocar nada del teléfono. Lo que no se puede medir por cable aparece como «Prueba manual».'));
}

function testsSection(d, i, st) {
  let touchOn = false;
  const touchBtn = actionButton('Prueba táctil: activar', (btn) => st.run(btn, () => window.api.diagTest(d.serial, 'touch', !touchOn), (on) => {
    touchOn = on; btn.textContent = on ? 'Prueba táctil: desactivar' : 'Prueba táctil: activar';
    return on ? 'Desliza el dedo por toda la pantalla: las líneas deben ser continuas. Si se cortan, hay zonas muertas.' : 'Prueba táctil desactivada.';
  }), true);
  const menu = el('p', { class: 'muted small' });
  window.api.factoryMenu(i.manufacturer || i.marketName || '').then((r) => { if (r.ok && r.data) menu.textContent = `Menú de pruebas del fabricante: marca ${r.data} en el teléfono (pantalla, altavoz, micrófono, sensores…).`; });
  return section('Pruebas manuales',
    el('div', { class: 'actions' },
      actionButton('Vibrar', (btn) => st.run(btn, () => window.api.diagTest(d.serial, 'vibrate'), () => '¿Ha vibrado? Si no, revisa el motor de vibración.'), true),
      touchBtn,
      actionButton('Abrir cámara trasera', (btn) => st.run(btn, () => window.api.diagTest(d.serial, 'camera'), () => 'Cámara abierta en el teléfono.'), true),
      actionButton('Abrir cámara frontal', (btn) => st.run(btn, () => window.api.diagTest(d.serial, 'selfie'), () => 'Cámara abierta en el teléfono (si sale la trasera, cambia a la frontal).'), true),
      actionButton('Ajustes de sonido', (btn) => st.run(btn, () => window.api.diagTest(d.serial, 'sound'), () => 'Prueba el tono de llamada desde ahí.'), true)),
    menu);
}

const SEVTXT = { alta: 'Grave', media: 'Media', baja: 'Leve' };
function renderAnalysis(a) {
  const head = el('p', { class: a.verdict === 'bad' ? 'err' : a.verdict === 'warn' ? 'warnt' : 'ok' }, a.summary);
  const items = a.findings.map((f) => el('div', { class: `finding ${f.sev}` },
    el('div', { class: 'ftitle' }, el('span', { class: `pill sev-${f.sev}` }, SEVTXT[f.sev] || f.sev), f.title, f.count > 1 ? el('span', { class: 'muted small' }, ` · ${f.count} veces`) : null),
    el('div', { class: 'small' }, f.explain),
    el('div', { class: 'small' }, el('b', {}, 'Qué revisar: '), f.fix),
    f.apps && f.apps.length ? el('div', { class: 'muted small' }, `Afecta a: ${f.apps.map((x) => `${x.name} (${x.count})`).join(', ')}`) : null,
    f.examples && f.examples.length ? el('details', {}, el('summary', { class: 'muted small' }, 'Ver líneas del registro'), el('pre', {}, f.examples.join('\n'))) : null));
  const hist = a.history && a.history.length ? el('p', { class: 'muted small' }, `Historial guardado en el teléfono: ${a.history.map((h) => `${h.title.toLowerCase()} (${h.count})`).join(', ')}.`) : null;
  const extra = a.reports != null ? el('p', { class: 'muted small' }, `Se han revisado ${a.reports} informes de fallo del iPhone (sin borrarlos).`) : null;
  return el('div', { class: 'analysis' }, head, ...items, hist, extra, el('p', { class: 'muted small' }, 'Interpretación automática y orientativa: confírmala con las pruebas de las piezas.'));
}

/** Botón de registro + análisis + líneas. Devuelve { label, run, box }. */
function logPanel(d, st) {
  const res = el('div', {});
  const out = el('pre', {}); const det = el('details', { hidden: '' }, el('summary', {}, d.platform === 'ios' ? 'Registro del sistema completo' : 'Últimas 2000 líneas del logcat'), out);
  const label = d.platform === 'ios' ? 'Analizar registro del sistema (10 s)' : 'Analizar logcat';
  const run = async (btn) => {
    put(res, el('p', { class: 'muted' }, 'Leyendo y analizando el registro…'));
    const lr = await st.run(btn, () => window.api.logs(d.platform, d.serial), () => 'Registro leído. Analizando…');
    if (!lr || !lr.ok) { put(res); return; }
    out.textContent = lr.data; det.hidden = false;
    const ar = await window.api.analyzeLogs(d.platform, d.serial, lr.data);
    if (!ar.ok) { put(res, el('p', { class: 'err' }, ar.error)); return; }
    st.say('Análisis terminado.', 'ok');
    cacheFor(d.serial).analysis = ar.data;
    put(res, renderAnalysis(ar.data));
  };
  return { label, run, box: el('div', {}, res, det) };
}

function reportSection(d, st) {
  const share = el('div', {});
  const create = actionButton('Crear informe en PDF', async (btn) => {
    const c = cacheFor(d.serial);
    const r = await st.run(btn, () => window.api.report(d.platform, d.serial, { components: c.components || null, analysis: c.analysis || null }), (x) => `Informe creado: ${x.name}`);
    if (!r || !r.ok) return;
    const { file, device } = r.data;
    const go = (label, fn, ok, ghost = true) => actionButton(label, (b) => st.run(b, fn, ok), ghost);
    put(share, el('p', { class: 'ok small' }, `📄 ${r.data.name}`), el('div', { class: 'actions' },
      go('Abrir', () => window.api.reportOpen(file), () => 'Abierto.', false),
      go('Guardar como…', () => window.api.reportSaveAs(file), (x) => `Guardado en ${x}`),
      go('Enviar por WhatsApp', () => window.api.reportWhatsapp(file), (how) => (how === 'copied' ? 'PDF copiado. En WhatsApp, abre el chat del cliente y pulsa Ctrl+V para adjuntarlo.' : 'He abierto la carpeta con el PDF: arrástralo al chat de WhatsApp.')),
      go('Enviar por correo', () => window.api.reportEmail(file, device), (how) => (how === 'copied' ? 'Correo abierto y PDF copiado: pulsa Ctrl+V en el mensaje para adjuntarlo.' : 'Correo abierto. He abierto la carpeta con el PDF: arrástralo al mensaje.')),
      go('Copiar PDF', () => window.api.reportCopy(file), () => 'PDF copiado: pégalo (Ctrl+V) donde quieras compartirlo.'),
      d.platform === 'android' ? go('Pasar al móvil del cliente', () => window.api.reportToPhone(file, d.platform, d.serial), (x) => `Copiado al teléfono en ${x} (carpeta Descargas).`) : null,
      go('Mostrar en la carpeta', () => window.api.reportShow(file), () => 'Carpeta abierta.')));
  });
  return section('Informe para el cliente', el('div', { class: 'actions' }, create), share,
    note('Incluye el dispositivo, la batería, el estado de cada pieza y, si lo has hecho, el análisis del registro. Con espacio para las firmas.'));
}

function diagTab(d, i, st) {
  const logs = logPanel(d, st);
  return el('div', {}, componentsSection(d, st), d.platform === 'android' ? testsSection(d, i, st) : null, batterySection(d, st),
    section('Registro de fallos', el('div', { class: 'actions' }, actionButton(logs.label, logs.run)), logs.box,
      note(d.platform === 'ios' ? 'Lee el registro en directo y los informes de fallo guardados en el iPhone (reinicios, apps que se cierran), sin borrarlos.' : 'Lee el logcat, el historial de fallos y el motivo del último reinicio.')),
    reportSection(d, st));
}

function batterySection(d, st) {
  const box = el('div', { class: 'grid' }, el('p', { class: 'muted' }, 'Leyendo la batería…'));
  const verdict = el('div', {});
  window.api.battery(d.platform, d.serial).then((r) => {
    if (!r.ok) { box.replaceChildren(el('p', { class: 'err' }, r.error)); return; }
    const b = r.data;
    cacheFor(d.serial).battery = b;
    const health = card('Salud de la batería', b.healthPercent != null ? `${b.healthPercent} %` : 'No disponible');
    if (b.healthPercent != null) { const f = el('i'); f.style.width = `${Math.min(100, b.healthPercent)}%`; f.className = b.healthPercent >= 85 ? '' : b.healthPercent >= 80 ? 'warn' : 'bad'; health.append(el('div', { class: 'bar' }, f)); }
    box.replaceChildren(health,
      card('Ciclos de carga', b.cycleCount ?? 'No disponible'),
      card('Capacidad de diseño', b.designCapacityMah ? `${b.designCapacityMah} mAh` : '—'),
      card('Capacidad real a plena carga', b.fullChargeCapacityMah ? `${b.fullChargeCapacityMah} mAh` : '—'),
      card('Carga / temperatura', `${b.currentCapacityPercent ?? '—'} % · ${b.temperatureC ?? '—'} °C`),
      card('Voltaje', b.voltageMv ? `${b.voltageMv} mV` : '—'));
    const v = b.healthPercent == null ? ['muted', d.platform === 'ios' ? 'El iPhone no ha informado de la capacidad.' : 'Este Android no expone la capacidad de la batería a ADB (depende del fabricante).']
      : b.healthPercent >= 85 ? ['ok', 'Batería en buen estado.'] : b.healthPercent >= 80 ? ['warnt', 'Batería algo desgastada.'] : ['err', 'Batería degradada (por debajo del 80 %): se recomienda cambiarla.'];
    verdict.replaceChildren(el('p', { class: v[0] }, v[1]));
  });
  return section('Batería', box, verdict);
}

function appsTab(d, st) {
  const ios = d.platform === 'ios';
  const sys = el('input', { type: 'checkbox' });
  const filter = el('input', { type: 'search', class: 'search', placeholder: 'Filtrar por nombre o identificador…' });
  const list = el('ul', { class: 'files apps' });
  const chosen = new Set();
  let all = [];
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = all.filter((a) => !q || a.id.toLowerCase().includes(q) || String(a.name).toLowerCase().includes(q)).map((a) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = chosen.has(a.id);
      cb.addEventListener('change', () => (cb.checked ? chosen.add(a.id) : chosen.delete(a.id)));
      const btns = el('span', { class: 'rowbtns' });
      const mini = (label, fn, cls = '') => { const b = el('button', { class: `ghost mini act ${cls}` }, label); b.addEventListener('click', () => fn(b)); btns.append(b); };
      if (!ios) {
        mini(a.enabled ? 'Desactivar' : 'Activar', (b) => st.run(b, () => window.api.appsSetEnabled(d.serial, a.id, !a.enabled), (en) => { a.enabled = en; render(); return `${a.id} ${en ? 'activada' : 'desactivada'}.`; }));
      }
      mini('Desinstalar', (b) => st.run(b, () => window.api.appsUninstall(d.platform, d.serial, a.id, { system: a.system }), () => { all = all.filter((x) => x !== a); render(); return `${a.id} desinstalada.`; }), 'danger');
      const meta = ios ? `${a.id}${a.version ? ` · v${a.version}` : ''}` : `${a.versionCode ? `versión ${a.versionCode}` : ''}${a.enabled ? '' : ' · desactivada'}`;
      return el('li', {}, cb, el('div', {}, el('div', {}, a.name), el('div', { class: 'muted small' }, ios || a.name === a.id ? meta : `${a.id} · ${meta}`)), btns);
    });
    list.replaceChildren(...(rows.length ? rows : [el('li', { class: 'muted' }, 'Sin apps')]));
  };
  const load = async () => {
    list.replaceChildren(el('li', { class: 'muted' }, 'Cargando apps…'));
    chosen.clear();
    const r = await window.api.appsList(d.platform, d.serial, { system: sys.checked });
    if (!r.ok) { list.replaceChildren(el('li', { class: 'err' }, r.error)); return; }
    all = r.data; render();
  };
  sys.addEventListener('change', load);
  filter.addEventListener('input', render);
  const top = el('div', { class: 'actions' },
    actionButton(ios ? 'Instalar .ipa…' : 'Instalar APK…', (b) => st.run(b, () => window.api.appsInstall(d.platform, d.serial), (n) => (n === null ? 'Cancelado.' : 'App instalada.')).then(load)),
    ios ? null : actionButton('Copiar APK seleccionados', (b) => (chosen.size ? st.run(b, () => window.api.appsBackup(d.serial, [...chosen]), (x) => `${plural(x.count, 'app copiada', 'apps copiadas')} en ${x.dest}`) : st.say('Marca primero alguna app.')), true),
    ios ? null : actionButton('Recuperar app del sistema…', (b) => {
      const id = filter.value.trim();
      if (!/^[A-Za-z][\w]*(\.[A-Za-z0-9_]+)+$/.test(id)) { st.say('Escribe en el filtro el identificador exacto (p. ej. com.google.android.youtube) y pulsa de nuevo.'); return; }
      st.run(b, () => window.api.appsRestoreSystem(d.serial, id), () => `${id} recuperada.`).then(load);
    }, true));
  load();
  return el('div', {}, top,
    el('div', { class: 'actions' }, filter, el('label', { class: 'check' }, sys, ' Mostrar apps del sistema')),
    ios ? note('Solo se pueden instalar .ipa firmados para este iPhone (desarrollador o empresa); iOS no permite instalar apps de la App Store copiadas.')
      : note('Las apps del sistema no se borran de verdad sin root: se quitan para el usuario y se pueden recuperar. «Desactivar» es la opción más segura.'),
    list);
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

// ── Migración de móvil a móvil ──────────────────────────────────────────────
function migrateView() {
  selected = null; lastKey = ''; refresh();
  const det = $('#detail');
  const st = statusBox();
  const ready = () => lastDevices.filter((d) => d.state === 'device');
  const label = (d) => `${d.platform === 'ios' ? 'iPhone' : 'Android'} · ${d.marketName || d.model || d.serial}`;
  const selFrom = el('select', { class: 'search' }); const selTo = el('select', { class: 'search' });
  const fill = () => {
    const devs = ready();
    for (const [sel, idx] of [[selFrom, 0], [selTo, 1]]) {
      const prev = sel.value;
      sel.replaceChildren(...devs.map((d) => el('option', { value: d.serial }, label(d))));
      if (devs.some((d) => d.serial === prev)) sel.value = prev; else if (devs[idx]) sel.value = devs[idx].serial;
    }
  };
  const opts = { photos: ['Fotos y vídeos', true], files: ['Archivos (Descargas, Documentos, Música)', true], contacts: ['Contactos', true], apps: ['Apps (sin sus datos)', false] };
  const boxes = Object.fromEntries(Object.entries(opts).map(([k, [t, on]]) => { const cb = el('input', { type: 'checkbox' }); cb.checked = on; return [k, { cb, row: el('label', { class: 'check' }, cb, ` ${t}`) }]; }));
  const info = el('p', { class: 'muted small' });
  const go = actionButton('Empezar', () => {});
  const update = async () => {
    const devs = ready();
    const a = devs.find((d) => d.serial === selFrom.value); const b = devs.find((d) => d.serial === selTo.value);
    if (devs.length < 2) { info.textContent = 'Conecta los dos teléfonos (origen y destino) a la vez.'; go.disabled = true; return; }
    if (!a || !b || a.serial === b.serial) { info.textContent = 'Elige dos teléfonos distintos.'; go.disabled = true; return; }
    const r = await window.api.migratePlan(a.platform, b.platform);
    const p = r.ok ? r.data : { ok: false, reason: r.error };
    for (const [k, { row }] of Object.entries(boxes)) row.hidden = !p.ok || !p.items.includes(k);
    go.disabled = !p.ok;
    info.textContent = !p.ok ? p.reason : p.items.includes('full')
      ? 'iPhone a iPhone: se hace una copia completa del origen y se restaura en el destino (todo: fotos, WhatsApp, ajustes, apps). En el destino hay que desactivar «Buscar mi iPhone».'
      : a.platform === 'ios' ? 'Del iPhone se sacan fotos y contactos de su copia de seguridad y se pasan al Android.' : 'Se copian los datos al PC y de ahí al teléfono de destino.';
  };
  selFrom.addEventListener('change', update); selTo.addEventListener('change', update);
  const swap = el('button', { class: 'ghost' }, '⇅ Intercambiar');
  swap.addEventListener('click', () => { const v = selFrom.value; selFrom.value = selTo.value; selTo.value = v; update(); });
  go.addEventListener('click', () => {
    const devs = ready();
    const a = devs.find((d) => d.serial === selFrom.value); const b = devs.find((d) => d.serial === selTo.value);
    const o = Object.fromEntries(Object.entries(boxes).map(([k, { cb, row }]) => [k, cb.checked && !row.hidden]));
    st.run(go, (id) => window.api.migrate(id, { platform: a.platform, serial: a.serial }, { platform: b.platform, serial: b.serial }, o),
      (x) => `Hecho: ${x.hecho.join(', ')}.${x.avisos.length ? ` ${x.avisos.join(' ')}` : ''}`);
  });
  fill(); update();
  const timer = setInterval(() => { if (!document.body.contains(selFrom)) { clearInterval(timer); return; } if (!st.running) { fill(); update(); } }, 3000);
  det.replaceChildren(el('h3', {}, 'Pasar datos de un móvil a otro'),
    section('Origen y destino', el('div', { class: 'actions' }, el('span', {}, 'De'), selFrom), el('div', { class: 'actions' }, el('span', {}, 'A'), selTo, swap)),
    section('Qué pasar', ...Object.values(boxes).map((x) => x.row), info, el('div', { class: 'actions' }, go)),
    st.box);
}
$('#openMigrate').addEventListener('click', migrateView);

async function loadTools() {
  const r = await window.api.toolsStatus();
  if (!r.ok) return;
  $('#tools').replaceChildren(...r.data.map((t) => {
    const detail = el('div', { class: 'tooldetail', hidden: '' }, t.ok ? `${t.version || ''}` : t.error, el('br'), el('code', {}, t.path));
    const head = el('div', { class: `toolhead ${t.ok ? 'ok' : 'err'}` }, `${t.ok ? '✓' : '✗'} ${t.name}`);
    head.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    return el('li', {}, head, detail);
  }));
  if (r.data.some((t) => !t.ok)) $('#toolsBox').open = true;
}
$('#restartAdb').addEventListener('click', async () => {
  const b = $('#restartAdb'); const m = $('#adbMsg');
  b.disabled = true; m.className = 'muted small'; m.textContent = ' Reiniciando…';
  const r = await window.api.restartAdb();
  b.disabled = false; m.className = r.ok ? 'ok small' : 'err small'; m.textContent = r.ok ? ' ADB reiniciado.' : ` ${r.error}`;
  lastKey = ''; refresh(); loadTools();
});

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
