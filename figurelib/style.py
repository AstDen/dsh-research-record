"""Journal figure style: millimetres, thin grey axes, transparent PDF.

Ported from the author's ``matplotlib_temp_fig/matplotlib_def/matplotlib_config.py``
so a figure script needs one import path instead of a hard-coded absolute one:

    import sys; sys.path.insert(0, "<bundle>/figurelib")
    import figurelib as fg

    fig, axs = fg.make_figure(2, arrangement='row', width_mm=190,
                              single_panel_height_mm=50, extra_legend_mm=0)
    ...
    fg.save_figure(fig, "paper/figures/my_figure_en.pdf")

Everything is in millimetres because the target is a two-column journal: a
figure is allowed to be 90 mm (one column) or 190 mm (both columns) wide, and
its data area is 50 mm tall. Sizes guessed in inches are what make a paper's
figures disagree with each other.
"""

from __future__ import annotations

import os

# matplotlib warns (and re-reads its font cache every run) when the default
# config directory is not writable — which is the case in a sandbox. Point it
# at a temp dir before matplotlib is imported; the env var must be set first.
if not os.environ.get("MPLCONFIGDIR"):
    default = os.path.join(os.path.expanduser("~"), ".config", "matplotlib")
    if not os.access(default, os.W_OK):
        import tempfile

        os.environ["MPLCONFIGDIR"] = os.path.join(tempfile.gettempdir(), "mpl-figurelib")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

MM = 1 / 25.4
PT = 1 / 0.3527777778

JOURNAL_WIDTHS_MM = (90, 190)
SINGLE_PANEL_HEIGHT_MM = 50
NROW_MAX = 5
NCOL_MAX = 3

FONT_FAMILY = "Linux Libertine O"
FONT_SIZE = 8

#: Panel letters follow the language of the figure (Russian uses Cyrillic).
PANEL_LABELS = {
    "ru": list("абвгдежзиклмн"),
    "en": list("abcdefghijklmnopqrstuvwxyz"),
}


def _apply_rcparams() -> None:
    plt.rcParams["font.family"] = FONT_FAMILY
    plt.rcParams["font.size"] = FONT_SIZE
    plt.rcParams["mathtext.fontset"] = "cm"
    plt.rcParams["svg.fonttype"] = "none"
    plt.rcParams["axes.titlesize"] = FONT_SIZE
    plt.rcParams["legend.edgecolor"] = "none"
    plt.rcParams["legend.framealpha"] = 0.8
    plt.rcParams["legend.fancybox"] = False
    plt.rcParams["figure.facecolor"] = "none"
    # A missing font silently degrades every figure to DejaVu, which then
    # embeds a different family and looks nothing like the rest of the paper.
    plt.rcParams["pdf.fonttype"] = 42      # TrueType outlines, editable in the PDF
    plt.rcParams["ps.fonttype"] = 42


_apply_rcparams()


def font_available() -> bool:
    """True when the journal font is installed on this machine."""
    from matplotlib import font_manager

    return any(f.name == FONT_FAMILY for f in font_manager.fontManager.ttflist)


def style_report() -> dict:
    """What the current process will actually use — check it before a batch."""
    return {
        "font": plt.rcParams["font.family"][0] if isinstance(plt.rcParams["font.family"], list) else plt.rcParams["font.family"],
        "font_available": font_available(),
        "size_pt": plt.rcParams["font.size"],
        "pdf_fonttype": plt.rcParams["pdf.fonttype"],
    }


# ── axes ────────────────────────────────────────────────────────────────────
def setup_axes(ax) -> None:
    """Grey hairline spines, inward ticks, transparent axes patch."""
    ax.tick_params(axis="both", color="#7d7d7d", width=0.25 * PT,
                   length=1 * PT, direction="in")
    for spine in ("left", "right", "bottom", "top"):
        ax.spines[spine].set_linewidth(0.25 * PT)
        ax.spines[spine].set_color("#7d7d7d")
    ax.patch.set_alpha(0)


def set_axis_range(ax, axis, left, right, step, hide_left=False,
                   hide_right=False, decimals=2) -> None:
    """Fixed range and tick step; optionally hides the labels at the ends."""
    def formatter(value, _pos):
        if hide_left and abs(value - left) < 1e-10:
            return ""
        if hide_right and abs(value - right) < 1e-10:
            return ""
        return f"{value:.{decimals}f}"

    if axis == "x":
        ax.set_xlim(left, right)
        ax.xaxis.set_major_locator(ticker.MultipleLocator(step))
        ax.xaxis.set_major_formatter(ticker.FuncFormatter(formatter))
    elif axis == "y":
        ax.set_ylim(left, right)
        ax.yaxis.set_major_locator(ticker.MultipleLocator(step))
        ax.yaxis.set_major_formatter(ticker.FuncFormatter(formatter))
    else:
        raise ValueError("axis must be 'x' or 'y'")


# ── layout ─────────────────────────────────────────────────────────────────
def get_layout(n_panels, arrangement="row", width_mm=190,
               row_height_factor=0.7, col_height_mm=55, extra_legend_mm=8,
               single_panel_height_mm=SINGLE_PANEL_HEIGHT_MM) -> dict:
    """Sheet geometry for a panel grid, in mm.

    ``row``: 1..3 panels side by side. One panel owns the whole 50 mm height
    (its legend sits to the right, outside the data area). Two panels keep the
    same 50 mm sheet — the legend goes *inside* the panel, because a taller
    sheet for just two panels breaks the paper's rhythm. Three panels add
    ``extra_legend_mm`` below the data area for a footer legend.

    ``col``: 1..5 panels stacked, each ``col_height_mm`` tall.
    """
    if width_mm not in JOURNAL_WIDTHS_MM:
        raise ValueError(f"width_mm must be one of {JOURNAL_WIDTHS_MM}, got {width_mm}")

    if arrangement == "row":
        if not 1 <= n_panels <= NCOL_MAX:
            raise ValueError(f"row arrangement takes 1..{NCOL_MAX} panels, got {n_panels}")
        nrows, ncols = 1, n_panels
        height_mm = single_panel_height_mm
        if n_panels > 2:
            height_mm += extra_legend_mm
        elif n_panels == 2:
            height_mm += 0.0          # legend inside the panel: 190 x 50 mm, rigidly
    elif arrangement == "col":
        if not 1 <= n_panels <= NROW_MAX:
            raise ValueError(f"col arrangement takes 1..{NROW_MAX} panels, got {n_panels}")
        nrows, ncols = n_panels, 1
        height_mm = col_height_mm * nrows
    else:
        raise ValueError("arrangement must be 'row' or 'col'")

    return {
        "figsize_mm": (width_mm, height_mm),
        "figsize": (width_mm * MM, height_mm * MM),
        "nrows": nrows,
        "ncols": ncols,
    }


def make_figure(n_panels, arrangement="row", width_mm=190, **layout_kw):
    """Figure with the panel grid and :func:`setup_axes` already applied.

    Returns ``(fig, axs)`` with ``axs`` a flat list, so callers can zip it with
    panel labels.
    """
    layout = get_layout(n_panels, arrangement, width_mm, **layout_kw)
    fig, axs = plt.subplots(layout["nrows"], layout["ncols"],
                            figsize=layout["figsize"], layout="constrained",
                            squeeze=False)
    flat = list(axs.ravel())
    for ax in flat:
        setup_axes(ax)
    return fig, flat


def setup_panel_label(ax, label, fontsize=9, x=0.06, y=0.95, ha="left",
                      pad=0.15, edgecolor="black", linewidth=0.8) -> None:
    """Rounded white badge with the panel letter.

    One panel means no letters at all: there is nothing to reference as (a).
    Inside a ``twinx`` panel call :func:`panel_label_on_figure` instead — a
    text artist on the primary axes is painted under the twin's lines.
    """
    ax.text(x, y, label, transform=ax.transAxes, fontsize=fontsize,
            va="top", ha=ha, zorder=10,
            bbox=dict(boxstyle=f"round,pad={pad}", facecolor="white",
                      edgecolor=edgecolor, linewidth=linewidth))


def panel_label_on_figure(ax, label, fontsize=9, x=0.06, y=0.95, **kw) -> None:
    """Panel letter drawn on the figure canvas, above every axes (twinx-safe)."""
    ax.figure.text(x, y, label, transform=ax.transAxes, fontsize=fontsize,
                   va="top", ha="left", zorder=1000,
                   bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                             edgecolor="black", linewidth=0.8))


def setup_legend(ax, ncol=1, loc="upper right", outside=False, frameon=True,
                 fontsize=None, handles_labels=None):
    """Legend in the template style; ``outside`` puts it under the panel."""
    kw = dict(loc=loc, ncol=ncol, frameon=frameon)
    if fontsize is not None:
        kw["fontsize"] = fontsize
    if outside is True:
        kw.update(loc="upper center", bbox_to_anchor=(0.5, -0.20), ncol=ncol)
    if handles_labels is not None:
        return ax.legend(handles_labels[0], handles_labels[1], **kw)
    return ax.legend(**kw)


# ── output ─────────────────────────────────────────────────────────────────
def save_figure(fig, output_pdf, dpi=300) -> str:
    """Save the figure as PDF with a transparent background and close it."""
    directory = os.path.dirname(os.path.abspath(output_pdf))
    if directory:
        os.makedirs(directory, exist_ok=True)
    fig.savefig(output_pdf, format="pdf", dpi=dpi)
    plt.close(fig)
    print(f"Saved: {output_pdf}")
    return output_pdf


def pdf_page_size_mm(path) -> tuple:
    """(width_mm, height_mm) read from the PDF MediaBox — no external tools."""
    with open(path, "rb") as fh:
        head = fh.read(20000)
    import re

    match = re.search(rb"/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)", head)
    if match is None:
        raise ValueError(f"no MediaBox in {path}")
    x0, y0, x1, y1 = (float(v) for v in match.groups())
    return (x1 - x0) / 72 * 25.4, (y1 - y0) / 72 * 25.4
