'use strict';
// Restablecimiento de fábrica (hard reset) por los caminos oficiales.
// Nunca evita la protección de la cuenta (FRP de Google, bloqueo de activación de Apple):
// tras el borrado el teléfono pedirá la cuenta que tenía si no se quitó antes.
const tools = require('./tools');

const CONFIRM = 'BORRAR';
const need = (text) => { if (String(text || '').trim().toUpperCase() !== CONFIRM) throw new Error(`Escribe ${CONFIRM} para confirmar el borrado`); };

/** Cuentas de Google configuradas (salen en `dumpsys account`). */
function parseGoogleAccounts(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/Account \{name=([^,}]+), type=com\.google\}/g)) out.add(m[1].trim());
  return [...out];
}

async function androidCheck(serial) {
  const sh = (cmd) => tools.run('adb', ['-s', serial, 'shell', cmd], { timeout: 20000 }).then((r) => r.stdout).catch(() => '');
  const [acc, oem] = await Promise.all([sh('dumpsys account | grep -E "Account \\{name="'), sh('getprop sys.oem_unlock_allowed; getprop ro.boot.flash.locked')]);
  const google = parseGoogleAccounts(acc);
  const [oemAllowed, flashLocked] = oem.split(/\r?\n/).map((x) => x.trim());
  return { googleAccounts: google, bootloaderUnlocked: flashLocked === '0', oemUnlockAllowed: oemAllowed === '1' };
}

/** Abre en el teléfono la pantalla oficial de «Borrar todos los datos» (el cliente confirma con su PIN). */
async function androidOpenResetScreen(serial) {
  const tries = [
    'am start -n com.android.settings/.Settings\\$FactoryResetActivity',
    'am start -n com.android.settings/.Settings\\$ResetDashboardActivity',
    'am start -a android.settings.ACTION_PRIVACY_SETTINGS',
    'am start -a android.settings.SETTINGS',
  ];
  for (const t of tries) {
    const r = await tools.run('adb', ['-s', serial, 'shell', t], { timeout: 15000 }).then((x) => x.stdout + x.stderr).catch((e) => `Error ${e.message}`);
    if (!/Error|Exception|does not exist|unable to resolve/i.test(r)) return t.includes('FactoryReset') ? 'reset' : t.includes('ResetDashboard') ? 'dashboard' : 'settings';
  }
  throw new Error('No se pudo abrir Ajustes en el teléfono');
}

/** Abre Ajustes › Cuentas para quitar la cuenta de Google antes del borrado (evita el bloqueo FRP posterior). */
async function androidOpenAccounts(serial) {
  await tools.run('adb', ['-s', serial, 'shell', 'am start -a android.settings.SYNC_SETTINGS'], { timeout: 15000 });
  return true;
}

async function androidToRecovery(serial) {
  await tools.run('adb', ['-s', serial, 'reboot', 'recovery'], { timeout: 20000 });
  return true;
}

/** Estado del bootloader en modo fastboot. */
async function fastbootUnlocked(serial) {
  const r = await tools.run('fastboot', ['-s', serial, 'getvar', 'unlocked'], { timeout: 15000 }).catch((e) => ({ stdout: '', stderr: e.message }));
  const m = `${r.stdout}\n${r.stderr}`.match(/unlocked:\s*(yes|no)/i);
  return m ? m[1].toLowerCase() === 'yes' : null;
}

/** Borra datos con `fastboot -w`. Solo con el bootloader ya desbloqueado por el usuario. */
async function fastbootWipe(serial, confirm, reboot = true) {
  need(confirm);
  if (await fastbootUnlocked(serial) !== true) throw new Error('El bootloader está bloqueado: haz el borrado desde recovery o desde Ajustes del teléfono.');
  await tools.run('fastboot', ['-s', serial, '-w'], { timeout: 180000 });
  if (reboot) await tools.run('fastboot', ['-s', serial, 'reboot'], { timeout: 30000 }).catch(() => {});
  return true;
}

/** iPhone: modo recuperación para restaurar con Dispositivos Apple / iTunes / Finder. */
async function iosEnterRecovery(udid, confirm) {
  need(confirm);
  await tools.run('ideviceenterrecovery', [udid], { timeout: 30000 });
  return true;
}

module.exports = { CONFIRM, parseGoogleAccounts, androidCheck, androidOpenResetScreen, androidOpenAccounts, androidToRecovery, fastbootUnlocked, fastbootWipe, iosEnterRecovery };
