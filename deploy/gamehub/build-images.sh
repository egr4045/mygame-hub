#!/usr/bin/env bash
# Build the GAMEHUB platform images with the HOST network so the build reaches the npm registry.
# (This host resolves the registry to IPv6 with no IPv6 route inside the default bridge network;
#  --network=host uses the host's working IPv4 DNS. The host itself can reach the registry fine.)
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"   # absolute — stays valid after the cd below
cd "$DEPLOY_DIR/../.."   # repo root (build context)

docker build --network=host --target service -t gamehub-service:latest .
docker build --network=host --target web -t gamehub-web:latest .
docker build --network=host --target orchestrator -t gamehub-orchestrator:latest .
# examplegame is path-routed under the hub's own origin (mygame-quiz.ru/example-game/), not its own
# port — VITE_BASE_PATH must match the Caddy handle_path prefix in deploy/gamehub/Caddyfile.
docker build --network=host --target exampleweb --build-arg VITE_BASE_PATH=/example-game/ -t gamehub-examplegame:latest .
# admin is path-routed the same way (mygame-quiz.ru/admin/) — same VITE_BASE_PATH/Caddy pairing.
docker build --network=host --target adminweb --build-arg VITE_BASE_PATH=/admin/ -t gamehub-admin:latest .
# On-demand games (their own images):
docker build --network=host -t svoyak:latest deploy/svoyak
echo "Built gamehub-service / gamehub-web / gamehub-orchestrator / gamehub-examplegame / gamehub-admin / svoyak (latest)"
