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

async function select(d) {
  selected = d; lastKey = ''; refresh();
  const det = $('#detail');
  det.replaceChildren(el('p', { class: 'muted' }, 'Leyendo información…'));
  const out = el('pre', { hidden: '' });
  const msg = el('p', {});
  const busy = async (btn, fn) => { btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Trabajando…'; try { await fn(); } finally { btn.disabled = false; } };
  const show = (r, okText) => { if (r.ok) { msg.className = 'ok'; msg.textContent = okText(r.data); } else { msg.className = 'err'; msg.textContent = r.error; } };

  const actions = el('div', { class: 'actions' });
  const add = (label, fn, ghost) => { const b = el('button', { class: ghost ? 'ghost' : '' }, label); b.addEventListener('click', () => busy(b, fn)); actions.append(b); };

  if (d.state === 'fastboot') {
    for (const [m, l] of [['system', 'Reiniciar'], ['bootloader', 'Reiniciar a bootloader'], ['recovery', 'Reiniciar a recovery']]) {
      add(l, async () => show(await window.api.reboot(d.serial, m, true), () => 'Orden enviada.'), m !== 'system');
    }
    det.replaceChildren(el('h3', {}, 'Dispositivo en modo Fastboot'), el('div', { class: 'serial muted' }, d.serial), actions, msg);
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
  const st = i.storage;
  const used = st && st.totalBytes ? Math.round(((st.usedBytes ?? st.totalBytes - st.freeBytes) / st.totalBytes) * 100) : null;
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
  const storageCard = card('Almacenamiento', st ? `${fmtBytes(st.usedBytes ?? (st.totalBytes - st.freeBytes))} usados de ${fmtBytes(st.totalBytes)}` : '—');
  if (used !== null) storageCard.append((() => { const bar = el('i'); bar.style.width = `${used}%`; return el('div', { class: 'bar' }, bar); })());
  cards.push(storageCard);

  add('Captura de pantalla', async () => show(await window.api.screenshot(d.platform, d.serial), (f) => `Guardada en ${f}`));
  add(d.platform === 'ios' ? 'Registro del sistema (10 s)' : 'Logcat (últimas 2000 líneas)', async () => {
    const lr = await window.api.logs(d.platform, d.serial);
    show(lr, () => 'Registro cargado.'); if (lr.ok) { out.hidden = false; out.textContent = lr.data; }
  }, true);
  if (d.platform === 'android') {
    add('Instalar APK…', async () => show(await window.api.installApk(d.serial), (x) => (x ? 'APK instalado.' : 'Cancelado.')), true);
    for (const [m, l] of [['system', 'Reiniciar'], ['recovery', 'Reiniciar a recovery'], ['bootloader', 'Reiniciar a fastboot']]) {
      add(l, async () => show(await window.api.reboot(d.serial, m, false), () => 'Orden enviada.'), true);
    }
  }
  det.replaceChildren(el('h3', {}, i.name || i.model || d.serial), el('div', { class: 'serial muted' }, d.serial), el('div', { class: 'grid' }, cards), actions, msg, out);
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

$('#refresh').addEventListener('click', () => { lastKey = ''; refresh(); });
window.api.version().then((r) => { if (r.ok) $('#version').textContent = `v${r.data}`; });
loadTools();
refresh();
setInterval(refresh, 3000);
