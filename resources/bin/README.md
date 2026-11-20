Aquí van los binarios de terceros que se empaquetan con el instalador.
Se descargan con `npm run fetch-tools` (no se suben al repo):

- `platform-tools/` → Android SDK Platform-Tools oficial de Google (adb.exe, fastboot.exe).
- `libimobiledevice/` → build de Windows de libimobiledevice (idevice_id.exe, ideviceinfo.exe, idevicebackup2.exe…).

En iPhone, Windows necesita además el servicio "Apple Mobile Device Support"
(se instala con iTunes o con "Dispositivos Apple" de Microsoft Store).
