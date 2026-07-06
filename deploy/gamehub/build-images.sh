#!/usr/bin/env bash
# Build the GAMEHUB platform images with the HOST network so the build reaches the npm registry.
# (This host resolves the registry to IPv6 with no IPv6 route inside the default bridge network;
#  --network=host uses the host's working IPv4 DNS. The host itself can reach the registry fine.)
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"   # absolute — stays valid after the cd below
cd "$DEPLOY_DIR/../.."   # repo root (build context)

# examplegame needs GAMEHUB_PUBLIC_URL baked in at build time — read it from deploy/gamehub/.env.
if [ -f "$DEPLOY_DIR/.env" ]; then
  set -a; source "$DEPLOY_DIR/.env"; set +a
fi
: "${GAMEHUB_PUBLIC_URL:?set GAMEHUB_PUBLIC_URL in deploy/gamehub/.env}"

docker build --network=host --target service -t gamehub-service:latest .
docker build --network=host --target web -t gamehub-web:latest .
docker build --network=host --target orchestrator -t gamehub-orchestrator:latest .
docker build --network=host --target exampleweb --build-arg VITE_HUB_URL="$GAMEHUB_PUBLIC_URL" -t gamehub-examplegame:latest .
# On-demand games (their own images):
docker build --network=host -t svoyak:latest deploy/svoyak
echo "Built gamehub-service / gamehub-web / gamehub-orchestrator / gamehub-examplegame / svoyak (latest)"
