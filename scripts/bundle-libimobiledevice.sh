#!/usr/bin/env bash
# Empaqueta libimobiledevice actual (paquete MSYS2 ucrt64, compatible con iOS recientes)
# junto con todas las DLL de las que depende. Se ejecuta en el runner windows-latest
# (que trae MSYS2 en C:\msys64) o en un Windows con MSYS2 instalado:
#   C:\msys64\usr\bin\bash.exe -lc "cd '$PWD' && scripts/bundle-libimobiledevice.sh"
set -euo pipefail
export MSYSTEM=UCRT64
pacman -S --noconfirm --needed mingw-w64-ucrt-x86_64-libimobiledevice mingw-w64-ucrt-x86_64-ideviceinstaller >/dev/null
DEST="resources/bin/libimobiledevice"
rm -rf "$DEST"; mkdir -p "$DEST"
TOOLS="idevice_id ideviceinfo idevicebackup2 idevicescreenshot idevicesyslog idevicepair idevicediagnostics idevicename ideviceimagemounter idevicecrashreport ideviceenterrecovery ideviceinstaller"
for t in $TOOLS; do cp "/ucrt64/bin/$t.exe" "$DEST/"; done
# Copia las DLL de MSYS2 que necesitan (las de Windows las trae el sistema).
for t in $TOOLS; do
  ldd "/ucrt64/bin/$t.exe" | awk '/\/ucrt64\/bin\// {print $3}'
done | sort -u | while read -r dll; do cp "$dll" "$DEST/"; done
pacman -Q mingw-w64-ucrt-x86_64-libimobiledevice mingw-w64-ucrt-x86_64-ideviceinstaller > "$DEST/VERSION.txt"
("$DEST/ideviceinstaller.exe" --help 2>&1 || true) | head -20
echo "libimobiledevice empaquetado en $DEST:"; ls "$DEST"
