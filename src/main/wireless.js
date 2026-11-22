'use strict';
// Conexión de Android por Wi-Fi (ADB inalámbrico). Siempre parte de un móvil ya autorizado
// o de un emparejamiento que se acepta en el propio móvil: no se salta ningún permiso.
const tools = require('./tools');

const ADDR_RE = /^(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9][a-z0-9.-]{0,250})(?::(\d{1,5}))?$/i;

function normAddress(address, defPort = 5555) {
  const m = String(address || '').trim().match(ADDR_RE);
  if (!m) throw new Error('Dirección no válida. Usa IP o IP:puerto, por ejemplo 192.168.1.40:5555');
  const port = m[2] ? Number(m[2]) : defPort;
  if (!(port > 0 && port < 65536)) throw new Error('Puerto no válido');
  return `${m[1]}:${port}`;
}

const isWifiSerial = (serial) => /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(serial) || /_adb-tls-connect\._tcp/.test(serial);

function parseWlanIp(text) {
  const m = String(text || '').match(/inet (\d{1,3}(?:\.\d{1,3}){3})\/\d+[^\n]*(?:wlan|swlan)/) || String(text || '').match(/inet (\d{1,3}(?:\.\d{1,3}){3})\//);
  return m && !m[1].startsWith('127.') ? m[1] : null;
}

/** Pasa un móvil conectado por USB (y ya autorizado) a ADB por Wi-Fi. */
async function enableTcpip(serial) {
  const { stdout } = await tools.run('adb', ['-s', serial, 'shell', 'ip -f inet addr show wlan0 2>/dev/null || ip -f inet addr show'], { timeout: 15000 });
  const ip = parseWlanIp(stdout);
  if (!ip) throw new Error('El móvil no está conectado a ninguna Wi-Fi. Conéctalo a la misma red que este PC.');
  await tools.run('adb', ['-s', serial, 'tcpip', '5555'], { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  return connect(`${ip}:5555`);
}

async function connect(address) {
  const addr = normAddress(address);
  const { stdout } = await tools.run('adb', ['connect', addr], { timeout: 20000 });
  if (!/connected to/i.test(stdout)) throw new Error(stdout.trim().includes('refused') ? `El móvil rechazó la conexión en ${addr}. Vuelve a pasarlo a Wi-Fi por USB o usa el emparejamiento.` : (stdout.trim() || `No se pudo conectar a ${addr}`));
  return { address: addr };
}

/** Android 11+: emparejar con el código de «Depuración inalámbrica» que muestra el móvil. */
async function pair(address, code) {
  const addr = normAddress(address, 0);
  if (!/^\d{6}$/.test(String(code || '').trim())) throw new Error('El código de emparejamiento tiene 6 cifras');
  const { stdout } = await tools.run('adb', ['pair', addr, String(code).trim()], { timeout: 30000 });
  if (!/Successfully paired/i.test(stdout)) throw new Error(stdout.trim() || 'No se pudo emparejar');
  return true;
}

async function disconnect(address) {
  await tools.run('adb', ['disconnect', normAddress(address)], { timeout: 15000 });
  return true;
}

module.exports = { normAddress, isWifiSerial, parseWlanIp, enableTcpip, connect, pair, disconnect };
