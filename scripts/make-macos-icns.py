#!/usr/bin/env python3
"""Rebuild src-tauri/icons/icon.icns from the full-bleed macOS master.

macOS is the one platform whose icon artwork differs from the rest, and it is
deliberate. macOS 26 (Tahoe) re-renders legacy .icns icons into its own rounded
shape: artwork that draws its *own* rounded rect on a transparent canvas gets
composited onto a light background plate and inset, which is why the installed
app used to show a grey border the dev build did not. Full-bleed artwork — no
transparency, no self-drawn corners — lets Tahoe apply its mask directly and the
icon renders clean.

Windows and Linux do not mask app icons, so icon.ico and the PNG sizes keep the
original rounded artwork with its speech-bubble tail; only the .icns is
full-bleed. The trade-off is that macOS releases before 26 draw .icns as-is and
will show a hard square.

Usage:  python3 scripts/make-macos-icns.py
Requires: Pillow, and iconutil (macOS Command Line Tools — no full Xcode needed).
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTER = ROOT / "src-tauri" / "icons" / "icon-macos.png"
OUTPUT = ROOT / "src-tauri" / "icons" / "icon.icns"

# (filename, pixel size) — the full set `iconutil` expects for an .icns.
VARIANTS = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


def main() -> int:
    if not MASTER.is_file():
        print(f"missing master artwork: {MASTER}", file=sys.stderr)
        return 1
    if shutil.which("iconutil") is None:
        print("iconutil not found — this script only runs on macOS", file=sys.stderr)
        return 1

    master = Image.open(MASTER).convert("RGBA")
    if master.size != (1024, 1024):
        print(f"master must be 1024x1024, got {master.size}", file=sys.stderr)
        return 1
    if master.getchannel("A").getextrema() != (255, 255):
        print("master must be fully opaque — transparency is what Tahoe plates", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        iconset = pathlib.Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for name, size in VARIANTS:
            master.resize((size, size), Image.LANCZOS).save(iconset / name)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(OUTPUT)],
            check=True,
        )

    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
