# Releasing Trapline

Releases are built entirely by GitHub Actions (`.github/workflows/release.yml`)
from a pushed tag — never from a developer machine. Binaries are Node SEA
executables produced by `scripts/build-sea.mjs` from official nodejs.org
binaries, checksummed, and published with build-provenance attestations.

## Cutting a release

1. Bump the version — the root `package.json` `version` field is the single
   source of truth (the server, the report footer, and the binaries all read
   it; release builds inject it at compile time):

   ```bash
   npm version 0.3.0 --no-git-tag-version
   git commit -am "Release v0.3.0"
   git push
   ```

2. Wait for CI to go green on `main`.

3. Tag and push. The tag must match the package.json version (the workflow
   verifies this and fails otherwise):

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

4. The Release workflow builds `linux-x64`, `linux-arm64`, `macos-arm64`,
   `macos-x64`, and `windows-x64`, smoke tests each binary, generates
   `SHA256SUMS.txt`, attests provenance, and publishes the GitHub release
   with per-OS install notes from `.github/release-notes-template.md`.

## Release candidates

Tags with a suffix (`v0.3.0-rc.1`) publish as **prereleases**. The version
check compares only the `vX.Y.Z` part, so `package.json` stays at `0.3.0`.
Use an rc tag to exercise the whole pipeline before tagging the real thing.

## Verifying what was published

```bash
gh release view v0.3.0
gh attestation verify trapline-v0.3.0-linux-x64 --repo l-small-tech/Trapline
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Local binary builds (for testing only)

```bash
npm run build:sea                                  # host target
node scripts/build-sea.mjs --target windows-x64    # cross-target
```

Cross-targets download the matching official Node binary (pinned to the Node
version you're running, checksum-verified). macOS binaries built anywhere
except macOS are unsigned and won't pass Gatekeeper — CI builds them on
macOS runners with an ad-hoc signature.
