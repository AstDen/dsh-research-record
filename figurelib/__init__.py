"""Journal figures in millimetres: style, layout, bilingual loop, checks.

    import figurelib as fg

    fig, axs = fg.make_figure(2, arrangement="row", width_mm=190)
    axs[0].plot(x, y, lw=1.2)
    axs[0].set_xlabel(r"$R$, mm"); axs[0].set_ylabel(r"$T_s$, K")
    fg.setup_panel_label(axs[0], "a")
    fg.save_figure(fig, "paper/figures/profiles_en.pdf")

    fg.bilingual_loop(build, "profiles", legend_ru={...}, legend_en={...})

Every size is millimetres because the sheet is the contract: one column is
90 mm, both columns 190 mm, the data area of a panel is 50 mm tall. See
``docs/FIGURES.md`` for the rules this module encodes.
"""

from __future__ import annotations

from .style import (  # noqa: F401
    FONT_FAMILY,
    FONT_SIZE,
    JOURNAL_WIDTHS_MM,
    MM,
    NCOL_MAX,
    NROW_MAX,
    PANEL_LABELS,
    PT,
    SINGLE_PANEL_HEIGHT_MM,
    font_available,
    get_layout,
    make_figure,
    panel_label_on_figure,
    pdf_page_size_mm,
    save_figure,
    set_axis_range,
    setup_axes,
    setup_legend,
    setup_panel_label,
    style_report,
)
from .bilingual import (  # noqa: F401
    auto_legend,
    bilingual_loop,
    footer_legend,
    legend_height_mm,
    make_footer_figure,
    nice_step,
    unit_label,
)
from .table import save_data_table  # noqa: F401
from .check import check_pdf  # noqa: F401

__all__ = [
    "MM", "PT", "FONT_FAMILY", "FONT_SIZE", "JOURNAL_WIDTHS_MM",
    "SINGLE_PANEL_HEIGHT_MM", "NROW_MAX", "NCOL_MAX", "PANEL_LABELS",
    "font_available", "style_report", "setup_axes", "set_axis_range",
    "get_layout", "make_figure", "setup_panel_label", "panel_label_on_figure",
    "setup_legend", "save_figure", "pdf_page_size_mm",
    "nice_step", "auto_legend", "bilingual_loop", "legend_height_mm",
    "make_footer_figure", "footer_legend", "unit_label",
    "save_data_table", "check_pdf",
]
