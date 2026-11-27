# Figures: hints and checklist

Practical guide for `figurelib` and the `matplotlib-figures` skill. The library
and the skill ship with this bundle; nothing else has to be installed except
matplotlib, pandas and numpy.

## Before drawing: four questions

1. **How many panels in a row?** 1 → 90 × 50 mm; 2 → 190 × 50 mm; 3 → 190 mm
   wide with a measured footer band. Ask `figure_spec` instead of guessing.
2. **Where does the legend go?** One panel: outside to the right. Two panels:
   inside the panel, corner chosen by `auto_legend`. Three panels: below the
   x-labels, with the band measured first.
3. **Which language(s)?** A Russian and an English PDF (`_ru`, `_en`), drawn by
   one call — never one file renamed.
4. **Where does the data come from?** A CSV plus a filter, or a table the script
   reads. If the number behind the curve exists only in the plotting script, the
   script is not done.

## Skeleton

```python
import matplotlib; matplotlib.use("Agg")
import figurelib as fg

def build(lang, strings, letters):
    fig, (ax_a, ax_b) = fg.make_figure(2, arrangement="row", width_mm=190)
    ax_a.plot(r, ts, color="#2a6f97", lw=1.2)
    ax_a.set_xlabel(strings["x"]); ax_a.set_ylabel(strings["y"])
    fg.set_axis_range(ax_a, "y", 400, 1600, 200, decimals=0)
    fg.setup_panel_label(ax_a, letters[0], x=0.06, y=0.94)
    return fig

fg.save_data_table(output_dir=".", txt_name="fig1", description="…",
                   params={"phi": "0.8"}, df=frame, sort_by=["FR,kW/m2"])
fg.bilingual_loop(build, "fig1", legend_ru=RU, legend_en=EN)
```

Three panels with a footer legend:

```python
fig, axs = fg.make_footer_figure(3, width_mm=190, legend_mm=8.0)
...
fg.footer_legend(fig, handles, labels, ncol=3, fontsize=7)
```

## Rules that break figures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Footer legend sits on the x-label | `constrained_layout` does not reserve space for `fig.legend` | `make_footer_figure` + `footer_legend` (measures the legend first) |
| Panel letter hidden behind a twin-axis line | the letter was drawn in data coordinates | `panel_label_on_figure(ax, "a")` |
| Fonts silently changed to DejaVu | the family is not installed (or only partly) | `fg.font_available()`, install the family, or set another one on purpose |
| Axis limits cut a tick, or ticks are 0.30000000000004 | tick step guessed by hand | `fg.nice_step(span)` and `set_axis_range(..., decimals=decimals(step))` |
| A one-panel figure carries a letter | letters only exist from two panels up | drop it |
| `FileNotFoundError: /home/…/.config/matplotlib` | the cache dir is read-only | `figurelib` sets `MPLCONFIGDIR` itself, or export it |

## Verify, do not hope

```bash
python3 figurelib/check.py fig1_en.pdf --width 190 --height 50   # JSON, exit 1 on problems
pdffonts fig1_en.pdf | head                                       # family and embedding
pdftoppm -r 200 -png fig1_en.pdf /tmp/fig                        # look at the page
```

`figure_check` (the tool) does the same from the chat: it reports the page size,
the embedded fonts, whether the family matches, and the warnings. Type 3 fonts
mean the text will not be selectable in the PDF — set `pdf.fonttype=42` (the
library does).

## Do not

- invent or interpolate data points to make a curve look better;
- "fix" a figure by editing the PDF (fix the script and re-run);
- encode a category by colour only — colour-blind readers lose it;
- use `jet`;
- ship one language by renaming the other;
- put a number in the caption that no script produced.
