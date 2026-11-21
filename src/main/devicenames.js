'use strict';
// Nombre comercial del dispositivo («Xiaomi Redmi Note 13 Pro 5G», «iPhone 13»…) además del código de modelo.
const fs = require('node:fs');
const path = require('node:path');
const tools = require('./tools');

// ── iPhone: ProductType → nombre ────────────────────────────────────────────
const IPHONE = {
  'iPhone6,1': 'iPhone 5s', 'iPhone6,2': 'iPhone 5s', 'iPhone7,2': 'iPhone 6', 'iPhone7,1': 'iPhone 6 Plus',
  'iPhone8,1': 'iPhone 6s', 'iPhone8,2': 'iPhone 6s Plus', 'iPhone8,4': 'iPhone SE (1.ª gen.)',
  'iPhone9,1': 'iPhone 7', 'iPhone9,3': 'iPhone 7', 'iPhone9,2': 'iPhone 7 Plus', 'iPhone9,4': 'iPhone 7 Plus',
  'iPhone10,1': 'iPhone 8', 'iPhone10,4': 'iPhone 8', 'iPhone10,2': 'iPhone 8 Plus', 'iPhone10,5': 'iPhone 8 Plus',
  'iPhone10,3': 'iPhone X', 'iPhone10,6': 'iPhone X', 'iPhone11,2': 'iPhone XS', 'iPhone11,4': 'iPhone XS Max',
  'iPhone11,6': 'iPhone XS Max', 'iPhone11,8': 'iPhone XR', 'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max', 'iPhone12,8': 'iPhone SE (2.ª gen.)', 'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12', 'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,6': 'iPhone SE (3.ª gen.)', 'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max', 'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
  'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max', 'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus',
  'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,5': 'iPhone 16e',
  'iPhone18,3': 'iPhone 17', 'iPhone18,4': 'iPhone Air', 'iPhone18,1': 'iPhone 17 Pro', 'iPhone18,2': 'iPhone 17 Pro Max',
};

function iosMarketName(productType) {
  if (!productType) return null;
  if (IPHONE[productType]) return IPHONE[productType];
  const fam = /^(iPhone|iPad|iPod)/.exec(productType);
  return fam ? `${fam[1]} (${productType})` : null;
}

// ── Android ─────────────────────────────────────────────────────────────────
// Propiedades donde los fabricantes guardan el nombre comercial (Xiaomi, OnePlus/Oppo/Realme, Huawei, Motorola…).
const MARKET_PROPS = [
  'ro.product.marketname', 'ro.product.vendor.marketname', 'ro.product.odm.marketname', 'ro.product.system.marketname',
  'ro.config.marketing_name', 'ro.vendor.oplus.market.name', 'ro.oppo.market.name', 'ro.vendor.oplus.market.enname',
  'ro.product.model.name', 'ro.product.display', 'ro.vivo.market.name',
];

let DB;
/** Lista oficial de Google Play (supported_devices.csv) reducida a JSON en el build: {m: {modelo: [marca, nombre]}, d: {codename: [marca, nombre]}} */
function loadDb(file) {
  if (DB !== undefined && !file) return DB;
  const f = file || path.join(tools.binRoot(), 'data', 'android-models.json');
  try { DB = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { DB = null; }
  return DB;
}
function resetDb() { DB = undefined; }

const norm = (s) => String(s || '').trim().toLowerCase();
// Clave de búsqueda: adb devices -l cambia «SM-G973F» por «SM_G973F», así que se ignoran signos y espacios.
const key = (s) => norm(s).replace(/[^a-z0-9]/g, '');
const BRAND_FIX = { google: 'Google', samsung: 'Samsung', xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi', oneplus: 'OnePlus', oppo: 'OPPO', realme: 'realme', motorola: 'Motorola', huawei: 'Huawei', honor: 'HONOR', vivo: 'vivo', nothing: 'Nothing', sony: 'Sony', nokia: 'Nokia', hmd: 'HMD', zte: 'ZTE', tcl: 'TCL', lenovo: 'Lenovo', asus: 'ASUS', lge: 'LG', lg: 'LG' };
const niceBrand = (b) => BRAND_FIX[norm(b)] || (b ? b.charAt(0).toUpperCase() + b.slice(1) : '');

function withBrand(brand, name) {
  const n = String(name).trim();
  if (!brand) return n;
  // "Redmi Note 13" ya identifica la marca comercial, pero se antepone la del fabricante: «Xiaomi Redmi Note 13».
  return norm(n).startsWith(norm(brand)) ? n : `${brand} ${n}`;
}

/**
 * @param {Record<string,string>} props salida de getprop
 * @returns {{name: string, source: 'prop'|'google'|'model'}}
 */
function androidMarketName(props, db = loadDb()) {
  const manufacturer = niceBrand(props['ro.product.manufacturer'] || props['ro.product.brand']);
  const model = props['ro.product.model'] || '';
  const device = props['ro.product.device'] || '';
  for (const k of MARKET_PROPS) {
    const v = (props[k] || '').trim();
    if (v && norm(v) !== norm(model) && !/^(unknown|null)$/i.test(v) && !/^[A-Z0-9]{2,}-?[A-Z0-9]+$/.test(v)) {
      return { name: withBrand(manufacturer, v), source: 'prop' };
    }
  }
  if (db) {
    const hit = (db.m && db.m[key(model)]) || (db.d && db.d[key(device)]);
    if (hit) return { name: withBrand(niceBrand(hit[0]) || manufacturer, hit[1]), source: 'google' };
  }
  return { name: withBrand(manufacturer, model || device), source: 'model' };
}

/** Convierte supported_devices.csv (UTF-16) en el JSON compacto. Prefiere coincidencias por modelo. */
function buildDb(csvText) {
  const m = {}; const d = {};
  const lines = csvText.replace(/^﻿/, '').split(/\r?\n/).slice(1);
  const cell = /"((?:[^"]|"")*)"|([^,]*)/g;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    line.replace(cell, (all, q, u, off) => { if (off === 0 || line[off - 1] === ',') cols.push(q !== undefined ? q.replace(/""/g, '"') : u); return all; });
    const [brand, name, device, model] = cols;
    if (!name) continue;
    const v = [brand || '', name];
    if (model && !m[key(model)]) m[key(model)] = v;
    if (device && !d[key(device)]) d[key(device)] = v;
  }
  return { m, d };
}

module.exports = { iosMarketName, androidMarketName, buildDb, loadDb, resetDb, MARKET_PROPS, IPHONE };
