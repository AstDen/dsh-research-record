"""The data table that accompanies a figure: what was actually plotted.

A figure in a paper is an argument, and the reviewer's first question is which
numbers it draws. The ``.txt`` written next to the PDF answers that: the
parameters of the run, the source file, and the plotted rows with enough
significant digits to re-plot without re-running anything.
"""

from __future__ import annotations

import os


def save_data_table(output_dir, txt_name, description, params, df, sort_by=None):
    """Write ``<output_dir>/<txt_name>.txt``: description, parameters, table.

    ``params`` is a plain dict of strings; ``df`` is the frame that was plotted
    (any object with ``columns``, ``iterrows()`` and ``len()``; pandas is used
    for sorting and NaN detection when available).
    """
    import pandas as pd

    if sort_by is not None:
        df = df.sort_values(sort_by)

    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{txt_name}.txt")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"=== {description} ===\n\n")
        fh.write("Parameters:\n")
        for key, value in params.items():
            fh.write(f"  {key} = {value}\n")
        fh.write(f"\nData points: {len(df)}\n\n")

        cols = list(df.columns)
        widths = {c: len(str(c)) for c in cols}
        rows = []
        for _, row in df.iterrows():
            cells = []
            for col in cols:
                value = row[col]
                if pd.isna(value):
                    text = "NaN"
                elif isinstance(value, float):
                    text = f"{value:.6g}"
                else:
                    text = str(value)
                cells.append(text)
                if len(text) > widths[col]:
                    widths[col] = len(text)
            rows.append(cells)

        fh.write("  ".join(str(c).ljust(widths[c]) for c in cols) + "\n")
        fh.write("  ".join("-" * widths[c] for c in cols) + "\n")
        for cells in rows:
            fh.write("  ".join(cell.ljust(widths[col])
                               for cell, col in zip(cells, cols)) + "\n")

    print(f"Saved: {path}")
    return path
