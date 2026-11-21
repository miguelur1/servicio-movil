# Servicio Móvil

Aplicación de escritorio para Windows que reúne funciones **legítimas** de servicio técnico
para Android e iPhone/iPad, usando las herramientas oficiales y de código abierto:

- **Android**: Android SDK Platform-Tools de Google (`adb`, `fastboot`).
- **iPhone/iPad**: [libimobiledevice](https://libimobiledevice.org/) (la misma base que usan otras herramientas de taller).

## Qué hace hoy (v0.1)

| Función | Android | iPhone |
|---|---|---|
| Detección automática de dispositivos (cada 3 s) | ✓ adb + fastboot | ✓ |
| Ficha: modelo, versión, build, parche, bootloader, nº serie | ✓ | ✓ |
| Batería (nivel, estado, salud, temperatura) | ✓ | nivel y carga |
| Almacenamiento usado/total | ✓ | ✓ |
| Captura de pantalla (se guarda en Documentos\Servicio Movil) | ✓ | ✓ (requiere Developer Disk Image) |
| Logs (logcat / syslog) | ✓ | ✓ |
| Instalar APK | ✓ | — |
| Reiniciar a sistema / recovery / bootloader | ✓ (también desde fastboot) | — |
| Auto-actualización desde GitHub Releases | ✓ | ✓ |

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
