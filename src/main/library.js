'use strict';
// Biblioteca local de esquemas y manuales por modelo: Documentos/Servicio Movil/Biblioteca/<modelo>/
const fs = require('node:fs');
const path = require('node:path');
const { photoKey } = require('./deviceart');

const dirFor = (root, name) => path.join(root, photoKey(name));

function list(root, name) {
  const dir = dirFor(root, name);
  if (!fs.existsSync(dir)) return { dir, files: [] };
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => { const st = fs.statSync(path.join(dir, e.name)); return { name: e.name, size: st.size, mtime: st.mtimeMs }; })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return { dir, files };
}

function add(root, name, sources) {
  const dir = dirFor(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const s of sources) fs.copyFileSync(s, path.join(dir, path.basename(s)));
  return list(root, name);
}

/** Ruta segura de un archivo de la biblioteca (impide salir de la carpeta del modelo). */
function fileFor(root, name, file) {
  const dir = dirFor(root, name);
  const f = path.join(dir, path.basename(file));
  if (path.dirname(f) !== dir || !fs.existsSync(f)) throw new Error('Archivo no encontrado en la biblioteca');
  return f;
}

module.exports = { list, add, fileFor, dirFor };
