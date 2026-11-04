#!/usr/bin/env python3
"""Rebuild the subsetted faces that lib/pdf.ts embeds in the daily report PDF.

    python3 -m pip install --user fonttools brotli
    python3 scripts/build-pdf-fonts.py

Takes the upstream Noto variable fonts, pins each to a single weight, and keeps only the
characters the report can print. See docs/pdf-fonts.md for why this exists.
"""
import os
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "fonts")
UPSTREAM = "https://raw.githubusercontent.com/google/fonts/main/ofl"

# Everything the report can put on a page, and nothing else.
UNICODES = ",".join([
    "U+0020-007E",   # basic latin
    "U+00A0-00FF",   # latin-1 supplement (·, °, accented vowels)
    "U+0100-017F",   # latin extended-A (ā, ī, Ś, ś)
    "U+1E00-1EFF",   # latin extended additional (ṛ, ṣ, ṇ, ḥ)
    "U+2010-2027",   # dashes, quotes, bullet, ellipsis
    "U+20A0-20BF",   # currency symbols, ₹ (U+20B9) among them
    "U+0964-0965",   # danda, double danda
    "U+2212",        # minus
])

FACES = [
    ("notosans/NotoSans%5Bwdth,wght%5D.ttf", 400, "NotoSans-Regular.ttf"),
    ("notosans/NotoSans%5Bwdth,wght%5D.ttf", 600, "NotoSans-SemiBold.ttf"),
    ("notoserif/NotoSerif%5Bwdth,wght%5D.ttf", 700, "NotoSerif-Bold.ttf"),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for path, weight, name in FACES:
            source = os.path.join(tmp, os.path.basename(path))
            if not os.path.exists(source):
                urllib.request.urlretrieve(f"{UPSTREAM}/{path}", source)
            pinned = os.path.join(tmp, f"pinned-{name}")
            run("fontTools.varLib.instancer", source, f"wght={weight}", "wdth=100", "-o", pinned)
            target = os.path.join(OUT, name)
            run("fontTools.subset", pinned, f"--unicodes={UNICODES}", "--layout-features=",
                "--no-hinting", "--desubroutinize", "--drop-tables+=GSUB,GPOS,GDEF,DSIG,FFTM",
                f"--output-file={target}")
            print(f"{name}: {os.path.getsize(target) / 1024:.0f} KB")
    print("\nThe OFL licence in public/fonts/OFL.txt must stay beside them.")


def run(module, *args):
    # fontTools is chatty, and its "Attempting to fix OTLOffsetOverflowError" notes look alarming
    # while being routine. Stay quiet unless something actually fails, then show everything.
    done = subprocess.run([sys.executable, "-m", module, *args], capture_output=True, text=True)
    if done.returncode:
        sys.stderr.write(done.stdout + done.stderr)
        raise SystemExit(f"{module} failed on {args[0]}")


if __name__ == "__main__":
    main()
