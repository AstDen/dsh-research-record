"""Bilingual figures: the RU/EN pair, corner-picked legends, unit labels.

The journal wants both language versions of a figure as two files
(``*_ru.pdf`` and ``*_en.pdf``), built by the same code: translating inside
the script is what keeps geometry identical between the two versions.
"""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np

from .style import (
    MM,
    PANEL_LABELS,
    SINGLE_PANEL_HEIGHT_MM,
    _apply_rcparams,
    save_figure,
    setup_axes,
)


def nice_step(span, target=6):
    """A round tick step giving roughly *target* labels on a span.

    A step cannot be a constant: the span follows the data, and the old step
    then produces dozens of overlapping labels. Take the closest of
    1 / 2 / 2.5 / 5 / 10 times a power of ten.
    """
    raw = span / max(target, 1)
    exp = np.floor(np.log10(raw))
    for mant in (1, 2, 2.5, 5, 10):
        if raw <= mant * 10 ** exp:
            return float(mant * 10 ** exp)
    return float(10 ** (exp + 1))


# ── legends ────────────────────────────────────────────────────────────────
def auto_legend(ax, handles, labels, ncol=1, fontsize=7,
                avoid=("upper left",), frameon=True, framealpha=0.9,
                labelspacing=0.25, handlelength=1.4, columnspacing=1.0,
                borderpad=0.3, title=None, verbose=True):
    """Put the legend inside the panel, in the corner that covers least data.

    Two panels side by side are rigidly 190 × 50 mm, so a legend below them
    would break the sheet; it has to live inside the data area. The corner is
    measured, not guessed: a probe legend is drawn to get its size, then the
    points of every line are counted inside each corner rectangle, and the
    corner with the fewest points wins. Corners overlapping the panel letter
    are only used when nothing else fits.
    """
    fig = ax.figure
    fig.canvas.draw()
    axbb = ax.get_window_extent()

    probe = ax.legend(handles=handles, labels=labels, loc="upper right",
                      ncol=ncol, fontsize=fontsize, frameon=frameon,
                      labelspacing=labelspacing, handlelength=handlelength,
                      columnspacing=columnspacing, borderpad=borderpad,
                      title=title, title_fontsize=fontsize)
    fig.canvas.draw()
    lbb = probe.get_window_extent()
    lw = lbb.width / axbb.width
    lh = lbb.height / axbb.height
    probe.remove()

    label_zone = (0.0, 0.82, 0.26, 1.0)      # the panel letter lives here

    def intersects(a, b):
        return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])

    candidates = {}
    for loc in ("upper right", "lower right", "lower left", "upper left"):
        if loc in avoid:
            continue
        x0 = 0.02 if "left" in loc else 1.0 - lw - 0.02
        y0 = 0.02 if "lower" in loc else 1.0 - lh - 0.02
        rect = (x0, y0, x0 + lw, y0 + lh)
        x_from = axbb.x0 + x0 * axbb.width
        x_to = axbb.x0 + (x0 + lw) * axbb.width
        y_from = axbb.y0 + y0 * axbb.height
        y_to = axbb.y0 + (y0 + lh) * axbb.height
        hits = 0
        for line in ax.lines:
            xy = line.get_xydata()
            if len(xy) == 0:
                continue
            px, py = ax.transData.transform(xy).T
            hits += int(((px > x_from) & (px < x_to) &
                         (py > y_from) & (py < y_to)).sum())
        candidates[loc] = (hits, rect)

    free = {k: v for k, v in candidates.items() if not intersects(v[1], label_zone)}
    pool = free or candidates
    best_loc, (best_hits, _) = min(pool.items(), key=lambda kv: kv[1][0])

    if verbose:
        share = f"{lw * 100:.0f}%×{lh * 100:.0f}% of the panel"
        if free:
            print(f"    legend: {best_loc} ({best_hits} points under the legend, {share})")
        else:
            print(f"    legend: {best_loc} ({best_hits} points under the legend, {share})"
                  " — WARNING: covers the panel letter, reduce ncol/fontsize")

    return ax.legend(handles=handles, labels=labels, loc=best_loc, ncol=ncol,
                     fontsize=fontsize, frameon=frameon, framealpha=framealpha,
                     labelspacing=labelspacing, handlelength=handlelength,
                     columnspacing=columnspacing, borderpad=borderpad,
                     title=title, title_fontsize=fontsize)


def legend_height_mm(fig, handles, labels, ncol=3, fontsize=7):
    """Height of the footer legend in mm, measured on this very figure."""
    probe = fig.legend(handles, labels, loc="lower center", ncol=ncol,
                       fontsize=fontsize, frameon=False)
    fig.canvas.draw()
    height = probe.get_window_extent().height / fig.dpi * 25.4
    probe.remove()
    return height


def make_footer_figure(n_panels, width_mm=190, panel_height_mm=SINGLE_PANEL_HEIGHT_MM,
                       xlabel_mm=12, gap_mm=3, legend_mm=0.0, title_mm=0.0,
                       left_mm=10, right_mm=2, top_mm=2):
    """Figure whose legend sits below the panels, with room actually reserved.

    ``constrained_layout`` does not reserve space for ``fig.legend``, so the
    legend ends up on top of the x-label. Here the sheet height is the sum of
    the parts (title + panels + x-label + gap + measured legend), and the axes
    rectangle is set by hand with ``subplots_adjust``.

    Measure the legend first on a same-width probe, or pass ``legend_mm=0``
    and call :func:`footer_legend`, which grows the figure when it knows the
    real height.
    """
    _apply_rcparams()
    height_mm = title_mm + panel_height_mm + xlabel_mm + gap_mm + legend_mm
    fig, axs = plt.subplots(1, n_panels, figsize=(width_mm * MM, height_mm * MM),
                            squeeze=False)
    flat = list(axs.ravel())
    for ax in flat:
        setup_axes(ax)
    bottom = (legend_mm + gap_mm + xlabel_mm * 0.45) / height_mm
    fig.subplots_adjust(left=left_mm / width_mm, right=1 - right_mm / width_mm,
                        top=1 - top_mm / height_mm, bottom=bottom,
                        wspace=0.28)
    return fig, flat


def footer_legend(fig, handles, labels, ncol=3, fontsize=7, gap_mm=3,
                  panel_height_mm=SINGLE_PANEL_HEIGHT_MM, xlabel_mm=12,
                  title_mm=0.0, top_mm=2):
    """Grow the figure to fit a footer legend, then place it below the panels."""
    need_mm = legend_height_mm(fig, handles, labels, ncol=ncol, fontsize=fontsize)
    width_mm = fig.get_size_inches()[0] / MM
    height_mm = title_mm + panel_height_mm + xlabel_mm + gap_mm + need_mm
    fig.set_size_inches(width_mm * MM, height_mm * MM)
    legend = fig.legend(handles, labels, loc="lower center", ncol=ncol,
                        fontsize=fontsize, frameon=False,
                        bbox_to_anchor=(0.5, 1.0 / height_mm))
    fig.subplots_adjust(bottom=(need_mm + gap_mm + xlabel_mm) / height_mm)
    return legend


# ── bilingual output ───────────────────────────────────────────────────────
def bilingual_loop(build_fn, base_pdf_name, legend_ru, legend_en,
                   languages=("ru", "en"), save=save_figure):
    """Build the RU and the EN version of one figure from the same code.

    ``build_fn(lang, legend_strings, panel_labels) -> fig``. Two files are
    written (``<base>_ru.pdf``, ``<base>_en.pdf``); renaming one of them to
    look like the other is what makes two versions drift apart.
    """
    written = []
    for lang in languages:
        if lang not in PANEL_LABELS:
            raise ValueError(f"unknown language {lang!r}; expected ru/en")
        strings = legend_ru if lang == "ru" else legend_en
        labels = PANEL_LABELS[lang]
        fig = build_fn(lang, strings, labels)
        out = f"{base_pdf_name}_{lang}.pdf"
        written.append(save(fig, out))
    return written


# ── labels ─────────────────────────────────────────────────────────────────
#: Units that differ between the two language versions of the same figure.
UNITS = {
    "mm": {"ru": "мм", "en": "mm"},
    "m": {"ru": "м", "en": "m"},
    "s": {"ru": "с", "en": "s"},
    "K": {"ru": "K", "en": "K"},
    "kW/m2": {"ru": "кВт/м$^2$", "en": "kW/m$^2$"},
    "W/m2": {"ru": "Вт/м$^2$", "en": "W/m$^2$"},
    "kg/m3": {"ru": "кг/м$^3$", "en": "kg/m$^3$"},
    "m/s": {"ru": "м/с", "en": "m/s"},
    "Pa": {"ru": "Па", "en": "Pa"},
    "1/m": {"ru": "1/м", "en": "1/m"},
    "K/m": {"ru": "K/м", "en": "K/m"},
    "K/s": {"ru": "K/с", "en": "K/s"},
}


def unit_label(symbol, unit, lang):
    """LaTeX label with the right unit spelling: ``unit_label('$T_s$', 'K', 'ru')``."""
    if unit not in UNITS:
        raise KeyError(f"unit {unit!r} is not in UNITS; add it there so both "
                       f"language versions stay in sync")
    return f"{symbol}, {UNITS[unit][lang]}"
