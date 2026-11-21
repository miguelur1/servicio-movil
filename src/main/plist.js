'use strict';
// Lector mínimo de plist XML (el formato que imprime idevicediagnostics). Sin dependencias.

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parsePlist(xml) {
  const tokens = String(xml).match(/<\/?[a-zA-Z]+\s*\/?>|[^<]+/g) || [];
  let i = 0;
  const skipText = () => { while (i < tokens.length && !tokens[i].startsWith('<')) i++; };
  const textUntil = (tag) => {
    let t = '';
    while (i < tokens.length && tokens[i] !== `</${tag}>`) t += tokens[i++];
    i++; // cierre
    return decode(t);
  };
  function value() {
    skipText();
    const tok = tokens[i++];
    if (!tok) return undefined;
    const tag = tok.replace(/[<>/\s]/g, '');
    if (/\/>$/.test(tok)) return tag === 'true' ? true : tag === 'false' ? false : tag === 'dict' ? {} : tag === 'array' ? [] : '';
    switch (tag) {
      case 'dict': {
        const o = {};
        for (;;) {
          skipText();
          if (tokens[i] === '</dict>') { i++; return o; }
          if (tokens[i] !== '<key>') { i++; if (i >= tokens.length) return o; continue; }
          i++;
          const k = textUntil('key');
          o[k] = value();
        }
      }
      case 'array': {
        const a = [];
        for (;;) {
          skipText();
          if (tokens[i] === '</array>' || i >= tokens.length) { i++; return a; }
          a.push(value());
        }
      }
      case 'integer': return Number(textUntil('integer'));
      case 'real': return Number(textUntil('real'));
      case 'string': return textUntil('string');
      case 'date': return textUntil('date');
      case 'data': return textUntil('data').replace(/\s+/g, '');
      case 'plist': { const v = value(); return v; }
      default: return value(); // <?xml…>, <!DOCTYPE…> se ignoran
    }
  }
  // Saltar cabeceras hasta <plist> o el primer valor.
  while (i < tokens.length && !/^<(plist|dict|array)/.test(tokens[i])) i++;
  return value();
}

module.exports = { parsePlist };
