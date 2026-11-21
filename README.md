# MVR Servicio Móvil

_Desarrollado por Miguel Velasco Rebollo._

Aplicación de escritorio para Windows que reúne funciones **legítimas** de servicio técnico
para Android e iPhone/iPad, usando las herramientas oficiales y de código abierto:

- **Android**: Android SDK Platform-Tools de Google (`adb`, `fastboot`).
- **iPhone/iPad**: [libimobiledevice](https://libimobiledevice.org/) (la misma base que usan otras herramientas de taller).

## Qué hace hoy (v0.2.1)

Compatible con cualquier Android con ADB (Samsung, Xiaomi, Motorola… y **Google Pixel**, con su driver USB oficial incluido e instalable desde la app) y con iPhone/iPad.

| Función | Android | iPhone/iPad |
|---|---|---|
| Detección automática de dispositivos (cada 3 s) | ✓ adb + fastboot | ✓ |
| Ficha: modelo, versión, build, parche, bootloader, nº serie | ✓ | ✓ |
| Batería y almacenamiento | ✓ | ✓ |
| Captura de pantalla / logs | ✓ | ✓ (captura: iOS 17+ requiere modo desarrollador) |
| Copia de seguridad completa | carpetas de usuario + contactos + SMS + APK opcionales | ✓ completa (idevicebackup2, como iTunes) |
| Restaurar copia / pasar datos a otro teléfono | ✓ (carpetas, apps; contactos a importar) | ✓ (también la copia de otro iPhone) |
| Fotos y vídeos al PC | ✓ directo | ✓ extraídas de la copia, formato original |
| Fotos del PC al teléfono | ✓ | — (Apple solo lo permite por restauración o iCloud) |
| Contactos → .vcf | ✓ | ✓ (desde la copia) |
| Mensajes → .csv | ✓ SMS (si el sistema lo permite) | ✓ SMS e iMessage (desde la copia) |
| Explorador de archivos | ✓ almacenamiento del teléfono | ✓ archivos de la copia (WhatsApp, notas, apps…) |
| Diagnóstico por piezas (pantalla, táctil, cámaras, sensores, huella, Wi-Fi, Bluetooth, NFC, módem, SIM, GPS, memoria, carga) | ✓ + pruebas manuales (vibración, táctil, cámaras) | ✓ módem, SIM, Wi-Fi, Bluetooth, proximidad y reinicios (panics) con la pieza probable |
| Análisis del registro: fallos, apps que se cierran, reinicios y qué revisar | ✓ logcat, historial de fallos y motivo del último reinicio | ✓ syslog e informes de fallo (sin borrarlos) |
| Salud de batería (ciclos, capacidad real vs. diseño) | ✓ (si el fabricante la expone) | ✓ |
| Gestor de apps: ver, instalar, desinstalar, copiar | ✓ APK/split APK; desactivar y recuperar apps del sistema | ✓ IPA firmados para el dispositivo (ideviceinstaller) |
| Pasar datos de un móvil a otro (los dos conectados) | Android→Android: fotos, archivos, contactos, apps | iPhone→Android: fotos y contactos · iPhone→iPhone: copia completa. Android→iPhone: Apple no lo permite por cable (se indica «Pasar a iOS») |
| Imagen del dispositivo: silueta por modelo, pantalla en directo y foto propia | ✓ | ✓ (pantalla en directo: iOS 17+ requiere modo desarrollador) |
| Reparación: lista de reparaciones (recomendadas por el diagnóstico) y guía paso a paso con fotos (iFixit, CC BY-NC-SA, en español si hay traducción); manuales oficiales, búsqueda de esquemas en tus sitios y biblioteca propia por modelo | ✓ | ✓ |
| Informe para el cliente en PDF (dispositivo, batería, piezas, análisis del registro) y compartir: WhatsApp, correo, copiar, guardar o pasar al móvil | ✓ | ✓ (pasar al móvil: solo Android) |
| Instalar APK, reiniciar a recovery/fastboot | ✓ | — |
| Auto-actualización desde GitHub Releases | ✓ | ✓ |

### Cómo funciona el lado iPhone

iOS no expone el teléfono como un disco. Para fotos, contactos, mensajes y archivos, la app hace
(o reutiliza) una **copia de seguridad local sin cifrar** con `idevicebackup2` y lee su `Manifest.db`.
Si el usuario tiene activado «Cifrar copia local», la copia se puede restaurar pero no leer.
Se empaqueta libimobiledevice actual (paquete MSYS2 `ucrt64`), compatible con iOS recientes.

### Limitaciones conocidas (honestas)

- Android 12+ no deja copiar los datos internos de las apps sin root; se copian los APK.
- Algunos Android no permiten leer SMS desde ADB: la app lo avisa.
- Restaurar en iPhone exige desactivar «Buscar mi iPhone» (protección de Apple, no se salta).
- Fotos en «iCloud con optimización de almacenamiento» no están en el teléfono y no salen en la copia.

## Fuera de alcance (no se implementará)

Bypass de FRP / cuenta Google, desbloqueo de activación iCloud, desbloqueo por IMEI / red,
eliminación de PIN o patrón, y cualquier cracking de servidores propietarios.
El flasheo se limitará a firmware oficial aportado por el usuario y con el bootloader ya
desbloqueado por el propio dueño.

## Desarrollo

```bash
npm install
npm run fetch-tools   # descarga adb/fastboot y libimobiledevice para Windows a resources/bin
npm start             # abre la app
npm test              # pruebas (los módulos se prueban con binarios falsos en test/fake-bin)
```

En iPhone, Windows necesita el controlador **Apple Mobile Device Support**
(viene con iTunes o con la app "Dispositivos Apple" de Microsoft Store).
En Android, el controlador USB del fabricante (p. ej. Samsung USB Driver) o el Google USB Driver.

## Publicar una versión (auto-actualización)

1. Sube la versión en `package.json` (p. ej. `0.2.0`) y llévala a `main`.
2. GitHub Actions compila el instalador `ServicioMovil-Setup-0.2.0.exe` en Windows y lo publica en Releases.
3. Las copias instaladas lo detectan al abrir (y cada 4 h), lo descargan y ofrecen «Reiniciar y actualizar».

Si el repositorio es **privado**, las copias instaladas no pueden leer sus Releases sin token;
para el auto-update conviene un repo público solo de releases o un servidor propio (proveedor `generic`).

> El instalador no está firmado todavía: Windows SmartScreen mostrará un aviso
> hasta que se añada un certificado de firma de código.
