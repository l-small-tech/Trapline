#!/usr/bin/env bash
# Nightly auto-update for the Trapline deployment on beast.
#
# Runs ON beast (via cron) inside the git clone at ~/docker-compose/trapline.
# Fetches origin/main; if the clone is already at that commit, exits quietly.
# Otherwise hard-resets to origin/main, rebuilds, restarts the container, and
# waits for health. Idempotent — safe to run by hand any time.
#
# Cron entry (crontab -e on beast):
#   30 4 * * * ~/docker-compose/trapline/deploy/auto-update.sh >> ~/docker-compose/trapline-autoupdate.log 2>&1
set -euo pipefail

REPO_DIR="$HOME/docker-compose/trapline"
BRANCH="main"
HEALTH_URL="http://127.0.0.1:8731/trapline/api/health"

say() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { say "ERROR: $*" >&2; exit 1; }

cd "$REPO_DIR" || die "repo dir $REPO_DIR not found"

git fetch origin "$BRANCH" --quiet || die "git fetch failed"

local_rev=$(git rev-parse HEAD)
remote_rev=$(git rev-parse "origin/$BRANCH")

if [[ "$local_rev" == "$remote_rev" ]]; then
    say "up to date at ${local_rev:0:9} — nothing to do"
    exit 0
fi

say "updating ${local_rev:0:9} → ${remote_rev:0:9}"
git reset --hard "origin/$BRANCH" --quiet

say "rebuilding and restarting container…"
docker compose -f "$REPO_DIR/docker-compose.yml" up -d --build --quiet-pull

say "waiting for health…"
for _ in $(seq 30); do
    if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
        say "healthy ✓ now running ${remote_rev:0:9}"
        exit 0
    fi
    sleep 2
done

die "container did not become healthy after update — check: docker logs --tail 50 trapline"
