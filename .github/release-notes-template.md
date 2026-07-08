Trapline __VERSION__ — standalone executables for desktop use. Download the file for your system, run it, and your browser opens the dashboard at `http://127.0.0.1:8731/trapline/`. No installer, no Docker, no Node.js required. Each binary is ~90–130 MB because it embeds the Node.js runtime and the web UI.

## Which file do I download?

| Your computer | File |
|---|---|
| Windows (Intel/AMD) | `trapline-__VERSION__-windows-x64.exe` |
| Mac with Apple Silicon (M1 or newer) | `trapline-__VERSION__-macos-arm64` |
| Mac with Intel CPU | `trapline-__VERSION__-macos-x64` |
| Linux (Intel/AMD) | `trapline-__VERSION__-linux-x64` |
| Linux (ARM, e.g. Raspberry Pi 4/5 64-bit) | `trapline-__VERSION__-linux-arm64` |

## Running it

**Windows** — double-click the `.exe`. SmartScreen will warn about an unknown publisher (the binary is unsigned — code-signing certificates cost money this free project doesn't spend): click **More info → Run anyway**. Keep the console window open; closing it stops monitoring. Data lives in `%LOCALAPPDATA%\Trapline`.

**macOS** — after downloading, clear the quarantine flag once and make it executable (Terminal):

```bash
chmod +x ~/Downloads/trapline-__VERSION__-macos-*
xattr -d com.apple.quarantine ~/Downloads/trapline-__VERSION__-macos-*
~/Downloads/trapline-__VERSION__-macos-arm64   # or -x64 on Intel Macs
```

(The binary is ad-hoc signed, not notarized — Gatekeeper blocks it until the quarantine attribute is removed.) Data lives in `~/Library/Application Support/Trapline`. Optional: `brew install mtr` enables route evidence.

**Linux** —

```bash
chmod +x ./trapline-__VERSION__-linux-x64
./trapline-__VERSION__-linux-x64
```

Data lives in `~/.local/share/trapline`. Optional: `sudo apt install mtr-tiny` enables route evidence.

Useful flags on every platform: `--port <n>`, `--data-dir <dir>`, `--no-browser`, `--help`. For best evidence, run on a machine **wired to your router** — Trapline warns in the dashboard if it detects it's monitoring over WiFi.

## Verifying your download

Checksums: compare against `SHA256SUMS.txt` (attached):

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing        # Linux
shasum -a 256 -c SHA256SUMS.txt --ignore-missing    # macOS
```

Build provenance: every binary is built from the tagged source by GitHub Actions in this repository, and carries a cryptographic attestation you can verify with the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify trapline-__VERSION__-linux-x64 --repo l-small-tech/Trapline
```

---

Prefer running from source or in Docker? See the [README](https://github.com/l-small-tech/Trapline#readme).
