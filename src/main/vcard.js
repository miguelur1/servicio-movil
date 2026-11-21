'use strict';
// Contactos → vCard 3.0 (lo importan Android, iPhone, Gmail, Outlook…).

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/**
 * @param {{name?:string, first?:string, last?:string, org?:string, note?:string,
 *          phones?:{value:string,type?:string}[], emails?:{value:string,type?:string}[]}[]} contacts
 */
function toVcf(contacts) {
  const out = [];
  for (const c of contacts) {
    const fn = c.name || [c.first, c.last].filter(Boolean).join(' ') || c.org || (c.phones && c.phones[0] && c.phones[0].value) || '';
    if (!fn && !(c.phones || []).length && !(c.emails || []).length) continue;
    out.push('BEGIN:VCARD', 'VERSION:3.0');
    out.push(`N:${esc(c.last || '')};${esc(c.first || (c.last ? '' : fn))};;;`);
    out.push(`FN:${esc(fn)}`);
    if (c.org) out.push(`ORG:${esc(c.org)}`);
    for (const p of c.phones || []) out.push(`TEL;TYPE=${(p.type || 'CELL').toUpperCase()}:${esc(p.value)}`);
    for (const e of c.emails || []) out.push(`EMAIL;TYPE=${(e.type || 'INTERNET').toUpperCase()}:${esc(e.value)}`);
    if (c.note) out.push(`NOTE:${esc(c.note)}`);
    out.push('END:VCARD');
  }
  return out.length ? `${out.join('\r\n')}\r\n` : '';
}

/** Lee un .vcf sencillo (el que genera toVcf u otros teléfonos) → lista de contactos. */
function parseVcf(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  const contacts = [];
  let cur = null;
  const unesc = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  for (const line of unfolded.split(/\r?\n/)) {
    if (/^BEGIN:VCARD/i.test(line)) { cur = { phones: [], emails: [] }; continue; }
    if (/^END:VCARD/i.test(line)) { if (cur) contacts.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    const val = line.slice(i + 1);
    if (key === 'FN') cur.name = unesc(val);
    else if (key === 'N') { const [last, first] = val.split(';'); cur.last = unesc(last || ''); cur.first = unesc(first || ''); }
    else if (key === 'TEL') cur.phones.push({ value: unesc(val) });
    else if (key === 'EMAIL') cur.emails.push({ value: unesc(val) });
    else if (key === 'ORG') cur.org = unesc(val.split(';')[0]);
    else if (key === 'NOTE') cur.note = unesc(val);
  }
  return contacts;
}

/** Mensajes → CSV (UTF-8 con BOM para que Excel lo abra bien). */
function toCsv(rows, columns) {
  const q = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\ufeff${[columns.map((c) => q(c.label)).join(';'), ...rows.map((r) => columns.map((c) => q(r[c.key])).join(';'))].join('\r\n')}\r\n`;
}

module.exports = { toVcf, parseVcf, toCsv };
