#!/usr/bin/env bash
# Cut a release: bump the app version, commit, tag vX.Y.Z, push.
#
#   ./scripts/release.sh 0.2.0
#
# Pushing the tag triggers .github/workflows/release.yml, which builds the
# installers and opens a draft GitHub Release.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

# ── Input ─────────────────────────────────────────────────────────────────────
[ $# -eq 1 ] || die "usage: $0 <version>   (e.g. $0 0.2.0)"
VERSION="${1#v}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] \
  || die "'$VERSION' is not a valid version (expected e.g. 0.2.0)"
TAG="v$VERSION"
export VERSION # read by the python lockfile fallback below

# ── Location ──────────────────────────────────────────────────────────────────
CONF="src-tauri/tauri.conf.json"
[ -f "$CONF" ] || die "run this from the repository root"

# ── Preconditions ─────────────────────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || die "on branch '$BRANCH' — releases are cut from main"

[ -z "$(git status --porcelain)" ] || die "working tree is not clean — commit or stash first"

git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] || die "main is not in sync with origin/main — pull or push first"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists locally"
[ -z "$(git ls-remote --tags origin "refs/tags/$TAG")" ] || die "tag $TAG already exists on origin"

CURRENT=$(node -p "require('./$CONF').version")
[ "$CURRENT" != "$VERSION" ] || die "version is already $VERSION"

# ── Bump versions ─────────────────────────────────────────────────────────────
bump_json() { # file — set .version=$VERSION, preserving 2-space formatting
  node -e "
    const fs = require('fs');
    const f = process.argv[1];
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.version = '$VERSION';
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  " "$1"
}
bump_json "$CONF"
bump_json "package.json"

# Cargo.toml + lockfile (first `version =` line is the package's own).
sed -i.bak "0,/^version = \".*\"/s//version = \"$VERSION\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak
if command -v cargo >/dev/null 2>&1; then
  (cd src-tauri && cargo update --workspace --offline --quiet)
else
  # No cargo on PATH: patch the lockfile entry directly.
  python3 - <<'EOF'
import io, re
path = "src-tauri/Cargo.lock"
src = io.open(path, encoding="utf-8").read()
import os
version = os.environ["VERSION"]
src = re.sub(
    r'(name = "lattice-desktop"\nversion = ")[^"]+(")',
    lambda m: m.group(1) + version + m.group(2),
    src, count=1,
)
io.open(path, "w", encoding="utf-8").write(src)
EOF
fi

# AppStream metainfo (shipped in the .deb; App Center reads the release entry).
METAINFO="src-tauri/assets/app.lattice.desktop.metainfo.xml"
sed -i.bak "s|<release version=\"[^\"]*\" date=\"[^\"]*\" />|<release version=\"$VERSION\" date=\"$(date +%F)\" />|" "$METAINFO"
rm -f "$METAINFO.bak"

# ── Commit, tag, push ─────────────────────────────────────────────────────────
git add "$CONF" package.json src-tauri/Cargo.toml src-tauri/Cargo.lock "$METAINFO"
git commit -m "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"
git push origin main

# The release commit touches Cargo.toml/Cargo.lock, which triggers cache-warm
# on main. Hold the tag until that run finishes: tag builds can only restore
# caches saved on main, so tagging early means compiling dependencies cold
# (see the 20-minute v0.5.1 builds). A cache-warm failure only warns — the
# release still goes out, just slower.
if command -v gh >/dev/null 2>&1; then
  echo "Waiting for cache-warm on $(git rev-parse --short HEAD) before pushing the tag…"
  RUN_ID=""
  for _ in $(seq 1 12); do # the run can take a few seconds to appear
    RUN_ID=$(gh run list --workflow=cache-warm.yml --commit "$(git rev-parse HEAD)" \
      --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
    [ -n "$RUN_ID" ] && break
    sleep 5
  done
  if [ -n "$RUN_ID" ]; then
    gh run watch "$RUN_ID" --exit-status \
      || echo "warning: cache-warm failed — release builds will run with a colder cache" >&2
  else
    echo "warning: no cache-warm run appeared; continuing without the warm cache" >&2
  fi
else
  echo "note: gh not installed — skipping the cache-warm wait" >&2
fi

git push origin "$TAG"

echo
echo "Pushed $TAG — CI is building the installers."
echo "Publish the draft release when the jobs finish:"
echo "  https://github.com/jsedlak/lattice/releases"
