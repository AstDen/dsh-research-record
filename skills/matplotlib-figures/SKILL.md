---
name: matplotlib-figures
description: Build publication figures with matplotlib to the journal's sheet contract — 90/190 mm wide, 50 mm data area, Linux Libertine O, RU/EN pair, legend placed by measurement. Use when creating or fixing a figure for a paper, thesis, report or talk, when a figure's size or fonts must match an existing set, or when a plot must be reproducible from its data table.
---

# Journal figures with matplotlib

A figure is part of the argument, and its sheet is a contract: one column is
90 mm, two columns are 190 mm, the data area of a panel is 50 mm tall. Sizes
guessed in inches are what make one paper's figures disagree with each other.

Use `figurelib/` (shipped with this bundle) instead of raw `plt.subplots`.
Ask `figure_spec` for the geometry before writing code, and `figure_check`
after saving — both answer questions that code cannot: what the sheet must be,
and whether the saved PDF obeys it.

## Ask before drawing

1. **How many panels, and in what arrangement?** 1–3 in a row, or up to 5
   stacked.
2. **Which language?** The journal wants both: `<name>_ru.pdf` and
   `<name>_en.pdf`, built by the same function with different strings. Panel
   letters follow the language (`а, б, в…` / `a, b, c…`); never rename one file
   to fake the other version.
3. **What is the y-quantity and its unit?** Use `unit_label("$T_s$", "K", lang)`
   so both versions spell the unit correctly.
4. **Is the legend a set of named curves or a continuous scale?** Named curves →
   legend inside the panel (two-panel sheet has no room below). A scale
   (F_R, radius, time) → colourbar shared across panels, no legend text.

## Sheet geometry

| Panels in a row | Sheet | Legend | Letters |
| --- | --- | --- | --- |
| 1 | 90 × 50 mm | to the right, outside the data area | none |
| 2 | **190 × 50 mm, rigidly** | inside the panel (`auto_legend`) | а/б, a/b |
| 3 | 190 × (50 + measured legend band) | below the panels, band reserved | а, б, в |

`fg.get_layout()` and the `figure_spec` tool produce these numbers;
`fg.make_figure()` applies them, `fg.make_footer_figure()` +
`fg.footer_legend()` reserve the footer band.

## Skeleton

```python
import sys; sys.path.insert(0, "<bundle>/figurelib")
import matplotlib; matplotlib.use("Agg")
import figurelib as fg

def build(lang, ls, letters):
    fig, (ax_a, ax_b) = fg.make_figure(2, arrangement="row", width_mm=190)
    for ax, column in ((ax_a, "Ts_mean, K"), (ax_b, "vel_mean, m/s")):
        for level, group in series:                         # data, not decoration
            ax.plot(group["R"], group[column], lw=1.2, color=color[level])
        ax.set_xlabel(ls["xlabel"])
        ax.set_ylabel(ls["ylabel"])
        fg.set_axis_range(ax, "y", lo, hi, fg.nice_step(hi - lo), decimals=1)
    fg.setup_panel_label(ax_a, letters[0], x=0.06, y=0.94)
    fg.setup_panel_label(ax_b, letters[1], x=0.06, y=0.94)
    return fig

fg.bilingual_loop(build, "paper/figures/profiles",
                  legend_ru={"xlabel": "$R$, мм", "ylabel": "$T_s$, K"},
                  legend_en={"xlabel": "$R$, mm", "ylabel": "$T_s$, K"})
```

The data table goes next to the PDF — the figure must be re-plottable without
re-running anything:

```python
fg.save_data_table(output_dir="paper/figures", txt_name="profiles",
                   description="Mean wall temperature and gas velocity vs R",
                   params={"hpm": "10 mm", "ds": "0.2 mm", "phi": "0.8"},
                   df=plotted, sort_by=["FR", "R"])
```

## Rules that break figures

- **Two panels are 190 × 50 mm, always.** A legend below them would need more
  height, so it goes inside the panel — and inside is where it overlaps data
  unless the corner is chosen by measurement. `fg.auto_legend()` counts the
  points under each corner and prints the choice; do not eyeball it.
- **`constrained_layout` does not reserve space for `fig.legend`.** With three
  panels build the footer band explicitly (`make_footer_figure` +
  `footer_legend`), or the legend lands on the x-label.
- **`twinx` hides a panel letter** drawn on the primary axes: use
  `fg.panel_label_on_figure(ax, "в")`, which draws on the figure canvas.
- **A missing font degrades silently.** If `Linux Libertine O` is absent,
  matplotlib falls back to DejaVu and every figure in the paper diverges from
  the rest. `fg.style_report()` tells you; `figure_check` catches the PDF.
- **Tick steps are computed, not copied.** `fg.nice_step(span)` keeps ~6 labels;
  a hard-coded step that fitted the previous range produces overlapping labels
  on the next one.
- **One panel gets no letter.** A letter with nothing to reference is noise,
  and the caption refers to "the figure", not "(a)".
- **Set `MPLCONFIGDIR`** when `~/.config/matplotlib` is not writable (sandbox,
  cluster, CI): matplotlib otherwise rebuilds its font cache on every run.
  `figurelib` does it automatically when the default path is not writable.

## Verify, do not hope

1. `figure_check(path=..., expect_width_mm=190, expect_height_mm=50)` — the
   sheet is what the typesetter scales, so a wrong size is a wrong figure.
2. Fonts: the report lists what is embedded; the journal family must be there.
3. Look at the page: `latex_look` (or `pdftoppm`) renders the PDF, and a figure
   that is geometrically correct can still have a legend covering a curve.
4. Both language files exist and differ only in text: same size, same fonts.

## Do not

- Do not invent data to fill a panel, and do not plot a curve without a file
  that produced it: the number in the caption must be traceable.
- Do not translate a figure by editing strings in the PDF, and do not regenerate
  only one language version after a data change.
- Do not use colour as the only encoding: the paper is also printed in
  greyscale, so pair the colour scale with a monotic lightness ramp
  (`viridis`, not `jet`).
