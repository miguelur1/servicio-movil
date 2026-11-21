'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repair = require('../src/main/repair');
const library = require('../src/main/library');
const settings = require('../src/main/settings');

const WIKI = {
  title: 'Xiaomi Redmi Note 11 Pro 5G', display_title: 'Xiaomi Redmi Note 11 Pro 5G', url: 'https://www.ifixit.com/Device/Xiaomi_Redmi_Note_11_Pro_5G',
  image: { standard: 'https://guide-images.cdn.ifixit.com/igi/dev.standard' }, description: 'Smartphone de Xiaomi.',
  documents: [{ title: 'Despiece', url: '/Document/abc/x.pdf', download_url: 'https://www.ifixit.com/Document/Download/abc' }, { filename: 'y.pdf', url: '/Document/def/y.pdf', display: null }],
  guides: [
    { guideid: 2, title: 'Xiaomi Redmi Note 11 Pro 5G Camera Replacement', subject: 'Camera', type: 'replacement', difficulty: 'Easy', time_required_max: 1800, url: 'u2', image: { medium: 'i2' } },
    { guideid: 1, title: 'Xiaomi Redmi Note 11 Pro 5G Battery Replacement', subject: 'Battery', type: 'replacement', difficulty: 'Moderate', time_required_max: 3600, url: 'u1', image: null },
    { guideid: 9, title: 'Battery Disconnection', subject: '', type: 'technique', flags: ['GUIDE_PREREQ_ONLY'], url: 'u9' },
    { guideid: 3, title: 'Xiaomi Redmi Note 11 Pro 5G Screen Replacement', subject: 'Display', type: 'replacement', difficulty: 'Difficult', url: 'u3' },
  ],
};
const GUIDE = {
  guideid: 1, title: 'Battery Replacement', difficulty: 'Moderate', time_required_max: 3600, url: 'u1', introduction_raw: "Cambia la '''batería'''. <script>x</script>",
  tools: [{ text: 'iOpener', url: 't' }], parts: [{ text: 'Batería', quantity: 1 }], author: { username: 'ana' },
  steps: [
    { orderby: 2, title: 'Quitar batería', lines: [{ text_raw: 'Despega la [link|https://x|lengüeta]', bullet: 'black', level: 0 }, { text_raw: 'No la perfores', bullet: 'icon_caution', level: 1 }], media: { type: 'image', data: [{ standard: 'img2' }] } },
    { orderby: 1, title: 'Calentar', lines: [{ text_raw: 'Aplica calor', bullet: 'icon_note', level: 0 }, { text_raw: '', bullet: 'black' }], media: { type: 'video', data: {} } },
  ],
};

function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.endsWith(k));
    if (!hit) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => hit[1] };
  };
}

test('candidates: añade variantes sin marca y sin 5G', () => {
  const c = repair.candidates('Xiaomi Redmi Note 11 Pro 5G');
  assert.ok(c.includes('Xiaomi Redmi Note 11 Pro 5G'));
  assert.ok(c.includes('Redmi Note 11 Pro 5G'));
  assert.ok(c.includes('Xiaomi Redmi Note 11 Pro'));
  assert.deepStrictEqual(repair.candidates('Google Pixel 8 Pro').slice(0, 2), ['Google Pixel 8 Pro', 'Pixel 8 Pro']);
});

test('deviceInfo: encuentra el modelo probando variantes y ordena guías', async () => {
  const calls = [];
  repair.setFetch(fakeFetch({ [`/wikis/CATEGORY/${encodeURIComponent('Xiaomi Redmi Note 11 Pro 5G')}`]: WIKI }, calls));
  const r = await repair.deviceInfo('Redmi Note 11 Pro 5G');
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.guides.map((g) => g.kind), ['screen', 'battery', 'rear_camera']);
  assert.strictEqual(r.guides[1].minutes, 60);
  assert.strictEqual(r.guides[2].image, 'i2');
  assert.deepStrictEqual(r.documents, [{ title: 'Despiece', url: 'https://www.ifixit.com/Document/Download/abc' }, { title: 'y.pdf', url: 'https://www.ifixit.com/Document/def/y.pdf' }]);
  assert.ok(!r.guides.some((g) => g.id === 9), 'oculta las guías auxiliares');
  assert.match(r.troubleshootingUrl, /Xiaomi_Redmi_Note_11_Pro_5G_Troubleshooting$/);
  assert.ok(calls.every((u) => u.startsWith('https://www.ifixit.com/api/2.0/')));
});

test('deviceInfo: sin resultados devuelve found=false', async () => {
  repair.setFetch(fakeFetch({}));
  assert.deepStrictEqual(await repair.deviceInfo('Teléfono raro'), { found: false, name: 'Teléfono raro' });
});

test('deviceInfo: usa la sugerencia de búsqueda si el nombre no coincide', async () => {
  repair.setFetch(fakeFetch({ [`/suggest/${encodeURIComponent('Pixel 8a')}?doctypes=category`]: { results: [{ title: 'Google Pixel 8a', dataType: 'wiki' }] }, [`/wikis/CATEGORY/${encodeURIComponent('Google Pixel 8a')}`]: { ...WIKI, title: 'Google Pixel 8a', display_title: 'Google Pixel 8a', guides: [] } }));
  const r = await repair.deviceInfo('Pixel 8a');
  assert.strictEqual(r.title, 'Google Pixel 8a');
});

test('guide: pasos ordenados, texto plano sin HTML y tipos de viñeta', async () => {
  repair.setFetch(fakeFetch({ '/guides/1?langid=es': GUIDE }));
  const g = await repair.guide(1);
  assert.strictEqual(g.intro, 'Cambia la batería. x');
  assert.deepStrictEqual(g.steps.map((s) => s.title), ['Calentar', 'Quitar batería']);
  assert.deepStrictEqual(g.steps[0].lines, [{ text: 'Aplica calor', level: 0, kind: 'note' }]);
  assert.deepStrictEqual(g.steps[1].lines[0], { text: 'Despega la lengüeta', level: 0, kind: 'normal' });
  assert.strictEqual(g.steps[1].lines[1].kind, 'caution');
  assert.deepStrictEqual(g.steps[1].images, ['img2']);
  assert.deepStrictEqual(g.steps[0].images, []);
  assert.strictEqual(g.author, 'ana');
  await assert.rejects(repair.guide('1; rm'), /no válida/);
});

test('guideKind: tipos de reparación', () => {
  const k = (t) => repair.guideKind(t);
  assert.strictEqual(k('iPhone 13 Front Camera Replacement'), 'front_camera');
  assert.strictEqual(k('iPhone 13 Rear Camera Replacement'), 'rear_camera');
  assert.strictEqual(k('iPhone 13 Face ID Sensor Replacement'), 'faceid');
  assert.strictEqual(k('Galaxy S10 Earpiece Speaker Replacement'), 'earpiece');
  assert.strictEqual(k('Galaxy S10 Loudspeaker Replacement'), 'speaker');
  assert.strictEqual(k('Pixel 8 USB-C Charging Port Replacement'), 'charging');
  assert.strictEqual(k('Pixel 8 Motherboard Replacement'), 'board');
  assert.strictEqual(k('Pixel 8 Power Button Replacement'), 'buttons');
});

test('searchLinks: incluye tus sitios con site:', () => {
  const [esq] = repair.searchLinks('Pixel 7', ['a.com', 'b.org']);
  assert.match(decodeURIComponent(esq.url), /Pixel 7 schematic diagram \(site:a\.com OR site:b\.org\)/);
  assert.ok(repair.searchLinks('Pixel 7').every((l) => l.url.startsWith('https://')));
});

test('settings: guarda solo dominios válidos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-'));
  assert.deepStrictEqual(settings.load(dir), { schematicSites: [] });
  const s = settings.save(dir, { schematicSites: ['https://Foro.Example.com/esquemas', '', 'no valido', 'x.org', 'x.org'] });
  assert.deepStrictEqual(s.schematicSites, ['foro.example.com', 'x.org']);
  assert.deepStrictEqual(settings.load(dir).schematicSites, ['foro.example.com', 'x.org']);
});

test('library: añade, lista y no deja salir de la carpeta', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  const src = path.join(root, 'esquema.pdf'); fs.writeFileSync(src, 'pdf');
  assert.deepStrictEqual(library.list(root, 'Pixel 7').files, []);
  const r = library.add(root, 'Pixel 7', [src]);
  assert.deepStrictEqual(r.files.map((f) => f.name), ['esquema.pdf']);
  assert.strictEqual(fs.readFileSync(library.fileFor(root, 'Pixel 7', 'esquema.pdf'), 'utf8'), 'pdf');
  assert.strictEqual(library.fileFor(root, 'Pixel 7', '../../esquema.pdf'), path.join(library.dirFor(root, 'Pixel 7'), 'esquema.pdf'));
  assert.throws(() => library.fileFor(root, 'Pixel 7', 'otro.pdf'), /no encontrado/);
});
