'use strict';
// Información de reparación en tiempo real desde la API pública de iFixit (guías paso a paso,
// piezas, herramientas y enlace a problemas/soluciones). Contenido de iFixit bajo CC BY-NC-SA:
// se muestra con atribución y enlace al original.
const API = 'https://www.ifixit.com/api/2.0';
const UA = 'MVR-Servicio-Movil';

let fetchImpl = (...a) => fetch(...a);
function setFetch(f) { fetchImpl = f; }

async function getJson(url) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`iFixit respondió ${r.status}`);
  return r.json();
}

/** Nombres que probar en iFixit a partir del nombre comercial («Xiaomi Redmi Note 11 Pro 5G» → también sin «Xiaomi»…). */
function candidates(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const out = [n];
  const noBrand = n.replace(/^(Xiaomi|Samsung|Google|Apple|Motorola|OnePlus|OPPO|realme|Huawei|HONOR|vivo|Sony|Nokia)\s+/i, '');
  if (/^Redmi|^POCO/i.test(noBrand)) out.push(`Xiaomi ${noBrand}`, noBrand);
  else if (noBrand !== n) out.push(noBrand);
  out.push(n.replace(/\s+5G$/i, ''), n.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  return [...new Set(out.filter(Boolean))];
}

/** Busca la categoría (dispositivo) de iFixit. */
async function findDevice(name) {
  for (const c of candidates(name)) {
    const w = await getJson(`${API}/wikis/CATEGORY/${encodeURIComponent(c)}`).catch(() => null);
    if (w && w.title) return w;
  }
  // Sugerencias de la búsqueda de iFixit.
  const s = await getJson(`${API}/suggest/${encodeURIComponent(name)}?doctypes=category`).catch(() => null);
  const hit = s && Array.isArray(s.results) && s.results.find((r) => r.dataType === 'wiki' || r.namespace === 'CATEGORY' || r.title);
  if (hit && hit.title) return getJson(`${API}/wikis/CATEGORY/${encodeURIComponent(hit.title)}`);
  return null;
}

const absUrl = (u) => (!u ? null : /^https:\/\//.test(u) ? u : u.startsWith('/') ? `https://www.ifixit.com${u}` : null);
const img = (o) => (o && (o.standard || o.medium || o['440x330'] || o.thumbnail)) || null;

// Tipos de reparación (el orden importa: lo más específico primero).
const KIND = [
  ['faceid', /face ?id|true ?depth|dot projector|flood illuminator/i],
  ['front_camera', /front[- ]?facing|front camera|selfie/i],
  ['fingerprint', /fingerprint|touch ?id|home button/i],
  ['earpiece', /earpiece|ear speaker/i],
  ['screen', /screen|display|lcd|oled|digitizer|front panel|front glass|pantalla/i],
  ['battery', /battery|bater/i],
  ['charging', /charging|charge port|usb|dock|lightning|conector/i],
  ['back', /back (cover|glass|panel|housing)|rear (cover|glass|panel|housing)|tapa/i],
  ['rear_camera', /camera|lens|c[áa]mara/i],
  ['speaker', /speaker|altavoz/i],
  ['microphone', /microphone|\bmic\b/i],
  ['buttons', /button|volume|side key|switch|bot[óo]n/i],
  ['vibrator', /vibrat|taptic/i],
  ['sim', /sim (card|tray|reader)|antenna/i],
  ['board', /motherboard|logic board|mainboard|board|placa/i],
];
const KIND_ORDER = ['screen', 'battery', 'charging', 'back', 'rear_camera', 'front_camera', 'faceid', 'fingerprint', 'speaker', 'earpiece', 'microphone', 'buttons', 'vibrator', 'sim', 'board', 'other'];
function guideKind(title) { const k = KIND.find(([, re]) => re.test(title)); return k ? k[0] : 'other'; }

function summarize(w) {
  const guides = (w.guides || []).filter((g) => !(g.flags || []).includes('GUIDE_PREREQ_ONLY')).map((g) => ({
    id: g.guideid, title: g.title, type: g.type, subject: g.subject, difficulty: g.difficulty || null,
    minutes: g.time_required_max ? Math.round(g.time_required_max / 60) : null, url: g.url, image: img(g.image), kind: guideKind(`${g.subject || ''} ${g.title}`),
  }));
  guides.sort((a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || ((a.type === 'replacement' ? 0 : 1) - (b.type === 'replacement' ? 0 : 1)));
  return {
    title: w.display_title || w.title, url: w.url || `https://www.ifixit.com/Device/${encodeURIComponent(String(w.title).replace(/ /g, '_'))}`,
    image: img(w.image), description: w.description || null,
    answersUrl: w.solutions_url || `https://www.ifixit.com/Answers/Device/${encodeURIComponent(String(w.title).replace(/ /g, '_'))}`,
    troubleshootingUrl: `https://www.ifixit.com/Wiki/${encodeURIComponent(`${String(w.title).replace(/ /g, '_')}_Troubleshooting`)}`,
    documents: (w.documents || []).map((d) => ({ title: d.title || d.filename, url: absUrl(d.download_url || d.url) })).filter((d) => d.url),
    guides,
  };
}

/** Texto de iFixit (marcado wiki) a texto plano seguro: sin HTML. */
function plain(raw) {
  return String(raw || '')
    .replace(/\[link\|[^|\]]*\|([^\]]*)\]/g, '$1').replace(/\[(?:product|guide|link)\|[^|\]]*\]/g, '')
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/'''|''|\*\*/g, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

async function guide(id) {
  if (!Number.isInteger(Number(id))) throw new Error('Guía no válida');
  const g = await getJson(`${API}/guides/${Number(id)}?langid=es`);
  if (!g) throw new Error('Guía no encontrada');
  return {
    id: g.guideid, title: g.title, difficulty: g.difficulty || null, minutes: g.time_required_max ? Math.round(g.time_required_max / 60) : null,
    url: g.url, intro: plain(g.introduction_raw), langid: g.langid || null,
    tools: (g.tools || []).map((t) => ({ name: t.text || t.title, url: t.url || null })),
    parts: (g.parts || []).map((p) => ({ name: p.text, quantity: p.quantity || 1, url: p.url || null })),
    steps: (g.steps || []).sort((a, b) => a.orderby - b.orderby).map((s) => ({
      n: s.orderby, title: plain(s.title),
      lines: (s.lines || []).map((l) => ({ text: plain(l.text_raw), level: l.level || 0, kind: /caution|red/.test(l.bullet) ? 'caution' : /note|icon_note/.test(l.bullet) ? 'note' : 'normal' })).filter((l) => l.text),
      images: ((s.media && s.media.type === 'image' && s.media.data) || []).map((m) => m.standard || m.medium || m.original).filter(Boolean),
    })),
    author: g.author && g.author.username ? g.author.username : null,
  };
}

async function deviceInfo(name) {
  const w = await findDevice(name);
  if (!w) return { found: false, name };
  return { found: true, ...summarize(w) };
}

/** Enlaces de búsqueda para lo que no es público (esquemas, vídeos). */
function searchLinks(name, sites = []) {
  const q = (s) => encodeURIComponent(s);
  const where = sites.length ? ` (${sites.map((d) => `site:${d}`).join(' OR ')})` : '';
  return [
    { label: sites.length ? `Esquemas en tus sitios (${sites.length})` : 'Esquemas y diagramas (buscar)', url: `https://www.google.com/search?q=${q(`${name} schematic diagram${where}`)}` },
    { label: 'Vídeos de reparación (YouTube)', url: `https://www.youtube.com/results?search_query=${q(`${name} cambio de pantalla`)}` },
    { label: 'Problemas típicos (foros)', url: `https://www.google.com/search?q=${q(`${name} problemas comunes solución`)}` },
    ...(/iphone|ipad/i.test(name) ? [{ label: 'Manuales oficiales de Apple (Self Service Repair)', url: 'https://support.apple.com/self-service-repair' }] : []),
    ...(/samsung|galaxy/i.test(name) ? [{ label: 'Guías oficiales de Samsung (autorreparación)', url: 'https://www.samsung.com/uk/support/self-repair/' }] : []),
  ];
}

/** Búsquedas cuando iFixit no tiene guía de esa reparación para el modelo. */
function repairSearch(name, repairEs, repairEn) {
  const q = (x) => encodeURIComponent(x);
  return [
    { label: 'Buscar en iFixit', url: `https://www.ifixit.com/Search?query=${q(`${name} ${repairEn}`)}` },
    { label: 'Vídeos en YouTube', url: `https://www.youtube.com/results?search_query=${q(`${name} ${repairEs}`)}` },
  ];
}

module.exports = { repairSearch, KIND_ORDER, deviceInfo, guide, candidates, plain, guideKind, searchLinks, setFetch, summarize };
