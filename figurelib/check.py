"""Verify a finished figure PDF against the journal rules.

The rules this checks are the ones a broken figure usually violates, and all
of them are cheap to read from the file itself:

* the sheet width is 90 mm (one column) or 190 mm (both columns);
* the sheet height matches the expected layout;
* the text is set in the journal family (Linux Libertine O by default), which
  is silently replaced by DejaVu when the font is missing on the machine;
* fonts are embedded (a PDF without embedded fonts looks different on the
  reviewer's machine).

Run from the command line::

    python3 figurelib/check.py paper/figures/profiles_en.pdf --width 190 --height 50
"""

from __future__ import annotations

import argparse
import json
import re
import sys

try:                                    # imported as part of the package
    from .style import FONT_FAMILY, JOURNAL_WIDTHS_MM, pdf_page_size_mm
except ImportError:                     # run as a script: python3 figurelib/check.py
    import os

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from figurelib.style import FONT_FAMILY, JOURNAL_WIDTHS_MM, pdf_page_size_mm


def _fonts(path):
    """Embedded font names, decoded from the PDF itself (no external tools)."""
    with open(path, "rb") as fh:
        data = fh.read()
    names = set()
    for raw in re.findall(rb"/BaseFont\s*/([#\w+\-.]+)", data):
        name = raw.decode("latin-1")
        if "+" in name:                      # subset prefix, e.g. ABCDEF+LinLibertineO
            name = name.split("+", 1)[1]
        names.add(name)
    return sorted(names)


def _font_types(path):
    """Font types reported by pdffonts when it is installed."""
    import shutil
    import subprocess

    if shutil.which("pdffonts") is None:
        return {}
    out = subprocess.run(["pdffonts", path], capture_output=True, text=True,
                         check=False).stdout.splitlines()
    types = {}
    for line in out[2:]:
        parts = line.split()
        if len(parts) >= 3:
            name = parts[0].split("+", 1)[-1]
            types[name] = parts[1]
    return types


def check_pdf(path, expect_width_mm=None, expect_height_mm=None,
              expect_font=None, width_tol_mm=0.6, height_tol_mm=0.6):
    """Return a report dict: ``ok``, measured size, fonts, and warnings."""
    expect_font = expect_font or FONT_FAMILY
    width_mm, height_mm = pdf_page_size_mm(path)
    fonts = _fonts(path)
    types = _font_types(path)
    warnings = []

    if expect_width_mm is not None:
        if abs(width_mm - expect_width_mm) > width_tol_mm:
            warnings.append(
                f"width {width_mm:.1f} mm, expected {expect_width_mm:.1f} mm")
    elif not any(abs(width_mm - w) <= width_tol_mm for w in JOURNAL_WIDTHS_MM):
        warnings.append(
            f"width {width_mm:.1f} mm is neither 90 nor 190 mm — the sheet will "
            f"be scaled by the typesetter")

    if expect_height_mm is not None and abs(height_mm - expect_height_mm) > height_tol_mm:
        warnings.append(
            f"height {height_mm:.1f} mm, expected {expect_height_mm:.1f} mm")

    # The PDF stores the PostScript name without spaces ("LinLibertineO" for
    # "Linux Libertine O"), so compare on letters and digits only.
    def normalize(text):
        return re.sub(r"[^a-z0-9]", "", text.lower())

    # The PDF keeps the PostScript name, which is shorter than the family name
    # ("LinLibertineO" for "Linux Libertine O"), so match on the distinctive
    # words of the family name instead of the whole string.
    words = [normalize(word) for word in expect_font.split() if len(word) >= 4]
    found = bool(words) and any(
        any(word in normalize(name) for word in words) for name in fonts)
    if fonts and not found:
        warnings.append(
            f"no {expect_font!r} in embedded fonts ({', '.join(fonts[:4])}) — "
            f"the font is probably not installed, so matplotlib fell back")

    type3 = sorted(n for n, t in types.items() if t == "Type 3")
    if type3:
        warnings.append(
            "Type 3 fonts (" + ", ".join(type3[:3]) + ") — set pdf.fonttype=42 "
            "if the text must stay selectable/editable")

    if not fonts:
        warnings.append("no embedded fonts found — text may not be selectable")

    return {
        "file": str(path),
        "ok": not warnings,
        "page_size_mm": [round(width_mm, 2), round(height_mm, 2)],
        "width_ok": any(abs(width_mm - w) <= width_tol_mm for w in JOURNAL_WIDTHS_MM),
        "fonts": fonts,
        "font_types": types,
        "expected_font": expect_font,
        "warnings": warnings,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check a figure PDF against the journal rules")
    parser.add_argument("pdf")
    parser.add_argument("--width", type=float, default=None, help="expected width, mm")
    parser.add_argument("--height", type=float, default=None, help="expected height, mm")
    parser.add_argument("--font", default=None, help="expected font family")
    args = parser.parse_args(argv)

    report = check_pdf(args.pdf, args.width, args.height, args.font)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
