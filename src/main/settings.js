'use strict';
// Ajustes persistentes sencillos (JSON en la carpeta de datos de la app).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { schematicSites: [] };

function load(dir) {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(dir, 'ajustes.json'), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

function save(dir, patch) {
  const cur = load(dir);
  const next = { ...cur, ...patch };
  if (patch.schematicSites) {
    next.schematicSites = [...new Set(patch.schematicSites.map((s) => String(s).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)))].slice(0, 20);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ajustes.json'), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { load, save, DEFAULTS };
