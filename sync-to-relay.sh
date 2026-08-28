#!/usr/bin/env bash
# Rebuildea el fork de agentation y lo lleva al frontend de relay.
#   - build (tsup) del paquete
#   - copia el dist + package.json al vendor de relay
#   - reinicia el contenedor relay_frontend (toma el file: dep nuevo)
# Uso: bash /home/jos/root/bookforce/agentation/sync-to-relay.sh
set -euo pipefail

FORK=/home/jos/root/bookforce/agentation/package
VENDOR=/home/jos/root/bookforce/relay/frontend/vendor/agentation

echo "▶ build del fork"
( cd "$FORK" && pnpm build >/dev/null )

echo "▶ vendorizando dist en relay"
rm -rf "$VENDOR/dist"
cp -r "$FORK/dist" "$VENDOR/dist"
# El package.json vendorizado va SIN devDependencies: un paquete ya buildeado no
# las necesita, y la de react/react-dom 18 hacía que bun instalara un segundo
# React anidado bajo node_modules/agentation → dos Reacts en el bundle (#418).
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
delete pkg.devDependencies;
fs.writeFileSync(process.argv[2] + "/package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$FORK" "$VENDOR"

echo "▶ limpiando caché de deps de Vite (si no, sirve el bundle viejo)"
docker exec relay_frontend sh -c 'rm -rf node_modules/.vite node_modules/.cache' 2>/dev/null || true

echo "▶ reiniciando relay_frontend"
docker restart relay_frontend >/dev/null

echo "✓ listo — hacé HARD reload en el navegador (Ctrl/Cmd+Shift+R) en http://localhost:3010"
