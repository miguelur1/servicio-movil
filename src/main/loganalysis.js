'use strict';
// Interpretación de registros: logcat (Android), syslog e informes de fallo (iPhone).
// Devuelve hallazgos con gravedad, explicación y qué revisar. Son orientativos: un técnico decide.

const SEV = { alta: 3, media: 2, baja: 1 };
const ERR_ANDROID = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+ [EF]\//;
const ERR_IOS = /<(Error|Fault|Critical)>/;

const pkgOf = (re) => (line) => { const m = line.match(re); return m ? m[m.length - 1] : null; };

const ANDROID = [
  { id: 'system_crash', sev: 'alta', title: 'Se ha caído el sistema (system_server)', re: /FATAL EXCEPTION IN SYSTEM PROCESS|Process: system_server/,
    explain: 'El núcleo de Android se ha cerrado. El teléfono se reinicia solo o se queda colgado.', fix: 'Si se repite: borrar caché, actualizar o reinstalar el firmware oficial. Si sigue, revisar memoria interna y placa.' },
  { id: 'watchdog', sev: 'alta', title: 'Bloqueos del sistema (watchdog)', re: /WATCHDOG KILLING SYSTEM PROCESS|Watchdog.*[Bb]locked in/,
    explain: 'Android se queda congelado y el vigilante lo reinicia.', fix: 'Suele venir de memoria interna lenta o dañada, o de un componente que no responde. Mirar también los fallos de almacenamiento.' },
  { id: 'verity', sev: 'alta', title: 'Sistema dañado o modificado (dm-verity)', re: /dm-verity|verity.*(corrupt|error)/i,
    explain: 'La partición del sistema no coincide con la firma esperada.', fix: 'Reinstalar el firmware oficial del fabricante.' },
  { id: 'storage_hw', sev: 'alta', title: 'Errores de lectura/escritura en la memoria interna', re: /EXT4-fs error|F2FS-fs.*(error|inconsistent)|I\/O error|blk_update_request|ufshcd.*(error|fail)|mmc\d+:.*error/i,
    explain: 'El sistema de archivos o el chip de memoria devuelve errores.', fix: 'Hacer copia de seguridad cuanto antes. Si persiste tras restaurar, el chip de memoria (eMMC/UFS) puede estar fallando.' },
  { id: 'anr', sev: 'media', title: 'Apps que no responden (ANR)', re: /ANR in ([\w.:]+)/, app: pkgOf(/ANR in ([\w.:]+)/),
    explain: 'Una app se ha quedado bloqueada más de 5 segundos.', fix: 'Actualizar o borrar datos de la app indicada. Si son muchas apps distintas, sospechar de falta de memoria o almacenamiento lento.' },
  { id: 'app_crash', sev: 'media', title: 'Apps que se cierran solas', re: /AndroidRuntime.*Process: ([\w.:]+), PID/, app: pkgOf(/Process: ([\w.:]+), PID/),
    explain: 'La app indicada se ha cerrado por un error.', fix: 'Actualizar, borrar caché/datos o reinstalar esa app.' },
  { id: 'native_crash', sev: 'media', title: 'Cierres de procesos nativos', re: /Fatal signal \d+ \(SIG\w+\)/, app: pkgOf(/pid \d+ \(([^)]+)\)/),
    explain: 'Un proceso de bajo nivel (app o servicio del sistema) ha fallado.', fix: 'Si es una app, actualizarla. Si es un servicio de cámara, audio o radio, revisar ese módulo.' },
  { id: 'storage_full', sev: 'media', title: 'Almacenamiento lleno', re: /No space left on device|ENOSPC|DeviceStorageMonitor.*low|[Ll]ow storage/,
    explain: 'El teléfono se ha quedado sin espacio y apps o actualizaciones fallan.', fix: 'Liberar espacio (fotos, vídeos, caché de apps).' },
  { id: 'thermal', sev: 'media', title: 'Sobrecalentamiento', re: /thermal.*(shutdown|throttl|critical|emergency)|ThermalEngine|overheat|temperature too high/i,
    explain: 'El sistema ha reducido rendimiento o apagado por temperatura.', fix: 'Revisar batería (hinchada), carga, apps en segundo plano y la pasta térmica si está abierto.' },
  { id: 'battery', sev: 'media', title: 'Avisos de batería', re: /health=(Overheat|Dead|Over voltage|Unspecified failure|Cold)|BATTERY_HEALTH_(OVERHEAT|DEAD|OVER_VOLTAGE)|battery.*(over ?voltage|dead)/i,
    explain: 'El sistema marca la batería con un estado anómalo.', fix: 'Comprobar la salud de la batería en esta misma pestaña y valorar cambiarla.' },
  { id: 'moisture', sev: 'media', title: 'Humedad o suciedad en el conector de carga', re: /moisture|liquid.*detect|water.*detect|usb.*over-?current/i,
    explain: 'El conector USB detecta humedad, suciedad o un cortocircuito.', fix: 'Secar y limpiar el puerto. Si sigue, cambiar el conector/flex de carga.' },
  { id: 'charging', sev: 'baja', title: 'Problemas de carga', re: /charger.*(fail|error|unsupported|weak)|charging.*(fail|error)/i,
    explain: 'El cargador no se reconoce bien o la carga se interrumpe.', fix: 'Probar otro cable y cargador. Si sigue, revisar el conector de carga.' },
  { id: 'sim', sev: 'media', title: 'Error de lectura de la SIM', re: /CARD_IO_ERROR|card io error|sim.*io error/i,
    explain: 'El lector no consigue leer la tarjeta SIM.', fix: 'Probar otra SIM. Si sigue, revisar la bandeja y el lector de SIM.' },
  { id: 'modem', sev: 'media', title: 'Reinicios del módem (cobertura)', re: /modem.*(crash|restart|reset|fatal)|subsystem restart|SSR.*modem|RADIO_NOT_AVAILABLE/i,
    explain: 'La parte de radio (llamadas y datos) se ha reiniciado.', fix: 'Actualizar el sistema. Si se pierde la cobertura a menudo, revisar antenas y módem.' },
  { id: 'camera', sev: 'media', title: 'Errores de cámara', re: /(CameraService|CameraProvider|Camera3-|camera@|CamX|mm-camera|cam_).*(error|fail|fatal|timeout)/i, onlyErr: true,
    explain: 'El servicio de cámara no consigue abrir o comunicarse con un módulo.', fix: 'Probar cada cámara. Si una no abre, revisar su módulo y el conector a placa.' },
  { id: 'fingerprint', sev: 'baja', title: 'Errores del lector de huellas', re: /(fingerprint|FingerprintService|fpc_|goodix_fp).*(fail|error|timeout)/i, onlyErr: true,
    explain: 'El sensor de huellas no responde bien.', fix: 'Volver a registrar la huella. Si falla, revisar el sensor y su flex.' },
  { id: 'touch', sev: 'media', title: 'Errores de la pantalla táctil', re: /(touch|tsp|synaptics|himax|novatek|focaltech|fts_).*(fail|error|firmware)/i, onlyErr: true,
    explain: 'El controlador táctil da errores.', fix: 'Hacer la prueba táctil de esta pestaña. Si hay zonas muertas, cambiar pantalla.' },
  { id: 'display', sev: 'media', title: 'Errores de pantalla o gráficos', re: /(SurfaceFlinger|HWComposer|hwcomposer|kgsl|mali|adreno|DSI|panel).*(fail|error|fault|timeout|hang)/i, onlyErr: true,
    explain: 'El sistema gráfico o el panel devuelven errores.', fix: 'Si hay parpadeos o rayas, revisar la pantalla y su flex.' },
  { id: 'wifi', sev: 'baja', title: 'Errores de Wi-Fi', re: /(WifiHAL|wpa_supplicant|wlan|WifiService|cnss).*(fail|error|crash|firmware)/i, onlyErr: true,
    explain: 'El chip o el servicio de Wi-Fi da errores.', fix: 'Olvidar la red y volver a conectar. Si no enciende el Wi-Fi, revisar antena y chip.' },
  { id: 'bluetooth', sev: 'baja', title: 'Errores de Bluetooth', re: /(bt_|[Bb]luetooth).*(crash|fail|error|timeout)/, onlyErr: true,
    explain: 'El servicio de Bluetooth da errores.', fix: 'Borrar los dispositivos emparejados y reintentar.' },
  { id: 'audio', sev: 'baja', title: 'Errores de audio', re: /(AudioFlinger|audio_hw|AudioHAL).*(fail|error)/i, onlyErr: true,
    explain: 'El sistema de sonido da errores.', fix: 'Probar altavoz, auricular y micrófono. Revisar el módulo que no suene.' },
  { id: 'sensors', sev: 'baja', title: 'Errores de sensores', re: /(SensorService|sensors?\.|Sensor HAL).*(fail|error)/i, onlyErr: true,
    explain: 'Algún sensor (proximidad, giroscopio, luz…) no responde.', fix: 'Mirar la lista de sensores de esta pestaña.' },
  { id: 'lowmem', sev: 'baja', title: 'Falta de memoria RAM', re: /lowmemorykiller|lmkd.*[Kk]ill|am_low_memory/, minCount: 10,
    explain: 'El sistema cierra apps en segundo plano porque no le llega la RAM.', fix: 'Normal de vez en cuando. Si es constante, quitar apps pesadas o restablecer.' },
];

const IOS = [
  { id: 'watchdog', sev: 'alta', title: 'Bloqueos del sistema (watchdog)', re: /watchdog.*(timeout|panic)|userspace watchdog/i,
    explain: 'iOS se ha quedado colgado y se ha reiniciado.', fix: 'Mirar los reinicios del sistema (panics) para saber qué pieza no responde.' },
  { id: 'nongenuine', sev: 'media', title: 'Piezas no originales o desconocidas', re: /not a genuine|unknown part|non-genuine|not genuine/i,
    explain: 'iOS detecta una pieza (pantalla, batería o cámara) no original o no emparejada.', fix: 'Informar al cliente. Algunas funciones (True Tone, salud de batería) pueden no ir.' },
  { id: 'app_crash', sev: 'media', title: 'Apps que se cierran solas', re: /ReportCrash|osanalyticshelper.*[Cc]rash|EXC_(BAD_ACCESS|CRASH)/, app: pkgOf(/(?:for|process) ([\w.]+)/),
    explain: 'Una app se ha cerrado por un error.', fix: 'Actualizar o reinstalar la app.' },
  { id: 'thermal', sev: 'media', title: 'Sobrecalentamiento', re: /thermal.*(heavy|critical|trapping|sleeping|serious)/i,
    explain: 'El iPhone ha limitado el rendimiento por temperatura.', fix: 'Revisar batería, carga y apps en segundo plano.' },
  { id: 'battery', sev: 'media', title: 'Avisos de batería', re: /Important Battery Message|battery.*(service|authentication fail)|peak power/i,
    explain: 'iOS marca la batería como degradada o no verificada.', fix: 'Comprobar la salud de la batería y valorar cambiarla.' },
  { id: 'storage_full', sev: 'media', title: 'Almacenamiento lleno', re: /low disk|No space left|LowDiskSpace/i,
    explain: 'El iPhone se queda sin espacio.', fix: 'Liberar espacio.' },
  { id: 'baseband', sev: 'media', title: 'Errores del módem (cobertura)', re: /(CommCenter|baseband|BBUpdater).*(crash|reset|fail|error)/i, onlyErr: true,
    explain: 'La parte de radio da errores.', fix: 'Si no hay cobertura o no detecta la SIM, revisar SIM, antenas y módem.' },
  { id: 'wireless', sev: 'baja', title: 'Errores de Wi-Fi o Bluetooth', re: /(wifid|bluetoothd|WiFiManager).*(fail|error|crash)/i, onlyErr: true,
    explain: 'El chip inalámbrico da errores.', fix: 'Restablecer ajustes de red. Si el Wi-Fi aparece en gris, revisar el chip.' },
  { id: 'jetsam', sev: 'baja', title: 'Falta de memoria RAM', re: /jetsam|memorystatus.*kill/i, minCount: 10,
    explain: 'iOS cierra apps porque no le llega la RAM.', fix: 'Normal de vez en cuando.' },
];

/** Pistas de los «panic» de iPhone: qué pieza suele estar detrás (orientativo). */
const PANIC_HINTS = [
  [/Missing sensor\(s\):[^\n"]*\bTG0[BV]\b/i, 'Sensor de temperatura de la batería', 'Batería no original o flex de batería. Probar con otra batería.'],
  [/Missing sensor\(s\):[^\n"]*\bmic\d/i, 'Micrófonos del flex de carga', 'Cambiar el flex del conector de carga.'],
  [/Missing sensor\(s\):[^\n"]*\bprs0\b/i, 'Barómetro (flex de carga)', 'Cambiar el flex del conector de carga.'],
  [/Missing sensor\(s\):[^\n"]*\b(TG0[^BV]|Tf|TP)/i, 'Sensor de temperatura', 'Revisar flex y conectores relacionados.'],
  [/no successful checkins from (com\.apple\.)?thermalmonitord/i, 'Sensores térmicos', 'Suele ser el flex de carga, la batería o el flex del botón de encendido.'],
  [/no successful checkins from (com\.apple\.)?wifid|AppleBCMWLAN|wlan.*(panic|timeout)/i, 'Chip Wi-Fi/Bluetooth', 'Reparación de placa (chip inalámbrico).'],
  [/ANS2|NAND|nvme|AppleANS/i, 'Memoria interna (NAND)', 'Copia de seguridad y reparación de placa (memoria).'],
  [/baseband|BBPanic|bbpanic/i, 'Módem (baseband)', 'Reparación de placa (módem) o restaurar firmware.'],
  [/AOP PANIC|AOP_PANIC|\bAOP\b/i, 'Coprocesador de sensores (AOP)', 'Revisar flex de sensores: proximidad/cámara frontal, carga y botones.'],
  [/SEP Panic|SEP panic|\bSEP\b/i, 'Enclave seguro (Face ID / Touch ID)', 'Revisar módulo Face ID / Touch ID. Puede ser de placa.'],
  [/i2c|smc|SMC PANIC/i, 'Bus de componentes (i2c / SMC)', 'Algún componente no responde: revisar flex recientemente cambiados.'],
];

function analyzeLines(text, rules, errRe) {
  const lines = [...new Set(String(text || '').split(/\r?\n/))];
  const found = new Map();
  for (const line of lines) {
    for (const r of rules) {
      if (!r.re.test(line)) continue;
      if (r.onlyErr && !errRe.test(line)) continue;
      let f = found.get(r.id);
      if (!f) { f = { id: r.id, sev: r.sev, title: r.title, explain: r.explain, fix: r.fix, count: 0, apps: {}, examples: [], minCount: r.minCount || 1 }; found.set(r.id, f); }
      f.count++;
      if (f.examples.length < 3) f.examples.push(line.trim().slice(0, 300));
      const a = r.app && r.app(line);
      if (a) f.apps[a] = (f.apps[a] || 0) + 1;
      break;
    }
  }
  return { lines: lines.length, findings: [...found.values()].filter((f) => f.count >= f.minCount) };
}

function finish(findings, extra = {}) {
  const list = findings.map(({ minCount, ...f }) => ({ ...f, apps: Object.entries(f.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })) }))
    .sort((a, b) => SEV[b.sev] - SEV[a.sev] || b.count - a.count);
  const top = list.length ? Math.max(...list.map((f) => SEV[f.sev])) : 0;
  const verdict = top >= 3 ? 'bad' : top === 2 ? 'warn' : 'ok';
  const summary = !list.length ? 'No se han encontrado fallos en el registro.'
    : verdict === 'bad' ? `Hay fallos graves: ${list.filter((f) => f.sev === 'alta').map((f) => f.title.toLowerCase()).join(', ')}.`
      : verdict === 'warn' ? `Hay ${list.length} tipo${list.length === 1 ? '' : 's'} de fallo a revisar.` : 'Solo avisos menores.';
  return { verdict, summary, findings: list, ...extra };
}

/** Motivo del último arranque de Android (sys.boot.reason / ro.boot.bootreason). */
function bootReason(reason) {
  const r = String(reason || '').toLowerCase();
  if (!r) return null;
  const table = [
    [/kernel_panic|panic/, 'alta', 'El último reinicio fue por un fallo grave del núcleo (kernel panic).'],
    [/watchdog|wdog|hw_reset|hard_reset/, 'alta', 'El último reinicio lo forzó el vigilante (watchdog): el teléfono se colgó.'],
    [/thermal/, 'media', 'El último apagado fue por temperatura.'],
    [/battery|undervoltage|power_loss|vbat|pmic/, 'media', 'El último apagado fue por batería o alimentación (batería agotada o fallo de energía).'],
    [/ota|recovery|bootloader|userrequested|shell|reboot|cold|normal|usb/, 'ok', 'Arranque normal.'],
  ];
  const hit = table.find(([re]) => re.test(r));
  return { raw: reason, sev: hit ? hit[1] : 'baja', text: hit ? hit[2] : 'Motivo de arranque poco habitual.' };
}

/** Entradas del historial de fallos de Android (dumpsys dropbox sin --print). */
function parseDropbox(text) {
  const tags = {};
  for (const m of String(text || '').matchAll(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (\S+) \(/gm)) tags[m[1]] = (tags[m[1]] || 0) + 1;
  return tags;
}

const DROPBOX = [
  ['SYSTEM_TOMBSTONE', 'media', 'Cierres nativos guardados'],
  ['system_server_crash', 'alta', 'Caídas del sistema guardadas'],
  ['system_server_watchdog', 'alta', 'Bloqueos del sistema guardados'],
  ['SYSTEM_LAST_KMSG', 'alta', 'Reinicios inesperados (registro del núcleo guardado)'],
  ['system_app_crash', 'media', 'Cierres de apps del sistema guardados'],
  ['system_app_anr', 'media', 'Bloqueos de apps del sistema guardados'],
  ['data_app_crash', 'baja', 'Cierres de apps guardados'],
  ['data_app_anr', 'baja', 'Bloqueos de apps guardados'],
];

function analyzeAndroid(text, { bootReason: br, dropbox } = {}) {
  const { lines, findings } = analyzeLines(text, ANDROID, ERR_ANDROID);
  const boot = bootReason(br);
  if (boot && boot.sev !== 'ok') findings.unshift({ id: 'boot', sev: boot.sev, title: 'Motivo del último reinicio', explain: `${boot.text} (${boot.raw})`, fix: 'Si se repite, revisar batería, temperatura y memoria interna.', count: 1, apps: {}, examples: [] });
  const history = [];
  const tags = parseDropbox(dropbox);
  for (const [tag, sev, title] of DROPBOX) if (tags[tag]) history.push({ tag, sev, title, count: tags[tag] });
  for (const h of history.filter((x) => x.sev === 'alta')) {
    if (!findings.find((f) => f.id === `hist_${h.tag}`)) findings.push({ id: `hist_${h.tag}`, sev: h.count >= 3 ? 'alta' : 'media', title: `${h.title} en los últimos días`, explain: `El teléfono guarda ${h.count} registro${h.count === 1 ? '' : 's'} de este tipo.`, fix: 'Reinicios o bloqueos repetidos: revisar batería, memoria interna y temperatura; reinstalar el firmware oficial si no es hardware.', count: h.count, apps: {}, examples: [] });
  }
  return finish(findings, { lines, boot, history });
}

/** Informes de fallo copiados del iPhone: [{ name, text }] */
function analyzeIosReports(reports) {
  const panics = []; const apps = {}; let jetsam = 0;
  for (const r of reports || []) {
    const n = r.name;
    if (/panic/i.test(n)) {
      const m = String(r.text || '').match(/"panicString"\s*:\s*"([^"]{0,400})|panic\(cpu \d+ caller [^)]*\):([^\n]{0,300})/);
      const raw = m ? (m[1] || m[2] || '').replace(/\\n/g, ' ').trim() : '';
      const hint = PANIC_HINTS.find(([re]) => re.test(r.text || ''));
      panics.push({ file: n, panic: raw.slice(0, 200), part: hint ? hint[1] : null, fix: hint ? hint[2] : null });
    } else if (/^JetsamEvent/i.test(n)) jetsam++;
    else if (/\.(ips|crash)$/i.test(n) && !/^(ExcResource|LowBattery|Stacks|Diagnostic|SiriSearch|log-aggregated|ResetCounter|wifi|analytics)/i.test(n)) {
      const app = n.replace(/[-_]\d{4}-\d\d-\d\d.*$/, '').replace(/\.(ips|crash)$/i, '');
      apps[app] = (apps[app] || 0) + 1;
    }
  }
  const findings = [];
  if (panics.length) {
    const parts = {};
    for (const p of panics) if (p.part) parts[p.part] = (parts[p.part] || 0) + 1;
    const main = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
    const hint = main && panics.find((p) => p.part === main[0]);
    findings.push({ id: 'panic', sev: panics.length >= 2 ? 'alta' : 'media', title: 'Reinicios del sistema (panic)',
      explain: main ? `La causa más repetida apunta a: ${main[0]}.` : 'El iPhone se ha reiniciado solo por un fallo grave.',
      fix: hint ? hint.fix : 'Si se repite, mirar el texto del panic para identificar la pieza.', count: panics.length, apps: {}, examples: panics.slice(0, 3).map((p) => `${p.file}: ${p.panic}`) });
  }
  const crashCount = Object.values(apps).reduce((a, b) => a + b, 0);
  if (crashCount) findings.push({ id: 'app_crash_reports', sev: 'baja', title: 'Cierres de apps guardados', explain: 'Informes de apps que se han cerrado solas.', fix: 'Actualizar o reinstalar las apps que más fallan.', count: crashCount, apps, examples: [] });
  if (jetsam >= 5) findings.push({ id: 'jetsam_reports', sev: 'baja', title: 'Falta de memoria RAM (informes)', explain: `${jetsam} informes de apps cerradas por falta de memoria.`, fix: 'Normal de vez en cuando.', count: jetsam, apps: {}, examples: [] });
  return { findings, panics };
}

function analyzeIos(text, reports) {
  const { lines, findings } = analyzeLines(text, IOS, ERR_IOS);
  const rep = analyzeIosReports(reports);
  return finish([...rep.findings, ...findings], { lines, panics: rep.panics, reports: (reports || []).length });
}

module.exports = { analyzeAndroid, analyzeIos, analyzeIosReports, bootReason, parseDropbox, PANIC_HINTS };
