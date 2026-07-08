#!/usr/bin/env bash
# Deploy Trapline to the beast Docker host.
#
# Ships the source tree to ~/docker-compose/trapline/ on beast (the convention
# for lsmall-managed compose projects there), builds the image on beast, and
# brings the container up. Idempotent — run again to redeploy.
#
# Usage: ./deploy/deploy-beast.sh [host]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BEAST="${1:-lsmall@beast.mallard}"
REMOTE_DIR="docker-compose/trapline"
COMPOSE="docker compose -f ~/$REMOTE_DIR/docker-compose.yml"
HEALTH_URL="http://127.0.0.1:8731/trapline/api/health"

say() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

command -v rsync >/dev/null || die "rsync not found locally"
ssh -o BatchMode=yes "$BEAST" true 2>/dev/null || die "cannot ssh to $BEAST (key auth)"

say "syncing source to $BEAST:~/$REMOTE_DIR/ …"
ssh "$BEAST" "mkdir -p ~/$REMOTE_DIR"
rsync -az --delete \
    --exclude node_modules \
    --exclude data \
    --exclude web/dist \
    --exclude .run \
    --exclude .git \
    "$ROOT"/ "$BEAST:$REMOTE_DIR/"

say "building image and starting container on beast (first build takes a few minutes)…"
ssh "$BEAST" "$COMPOSE up -d --build"

say "waiting for health…"
for _ in $(seq 30); do
    if ssh "$BEAST" "curl -fsS --max-time 2 $HEALTH_URL" >/dev/null 2>&1; then
        say "healthy ✓  ($HEALTH_URL on beast)"
        ssh "$BEAST" "docker ps --filter name=trapline --format '{{.Names}}: {{.Status}}'"
        exit 0
    fi
    sleep 2
done

die "container did not become healthy — check: ssh $BEAST 'docker logs --tail 50 trapline'"
