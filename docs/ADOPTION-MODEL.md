# Adoption model: universal roles, domain packs

The adoption skill must work for a researcher whose folder looks nothing like mine.
The failure mode to avoid is encoding *one* field's conventions (OpenFOAM time
directories) into the classifier and calling it "science".

This document separates what is universal from what is domain-specific, and says
where a colleague plugs in their own domain without editing code.

## 1. Four archetypes the model must cover

| archetype | what proves it | what a "run" looks like | what breaks a name-based classifier |
| --- | --- | --- | --- |
| **numerical / CFD** | `controlDict`, `fvSchemes`, `.cas.h5`, `.foam`, time directories | a case directory: config + mesh + fields + log | field files have no extension; `processor*` and time dirs look like "variants" |
| **experiment** | instrument exports (`.csv`, `.xlsx`, `.tif`, `.raw`), photos, protocols | a measurement session: date + settings + raw export + notes | session folders are named by date or by instrument, never "run" |
| **custom code** | `Makefile`, `*.f90`, `*.c`, `main.py`, `requirements.txt`, `*.in` | a build + input file + output table | "results" may be a single `out.dat` next to a shared `src/` |
| **literature work** | `.bib`, `refs/`, PDFs, `notes/` | a reading card + a synthesis draft | there is no run at all; `runs/` must not be created |

A project can be a mix (my `20_gradient_channel` is CFD + experiment + several
drafts). The model therefore **never picks one archetype**: it measures evidence
for every pack and reports the shares.

## 2. Two levels, two different questions

**Level 1 — what is this file?** (`kind`: table, pdf, image, mesh, field, dict,
code, notebook, log, archive, binary, document, other)

Detection order, cheapest first:

1. **magic bytes** — first 512 bytes, no extension needed:
   `%PDF-`, `\x89HDF`, `\x89CGNS`, `\x93NUMPY`, `PK\x03\x04` (zip: xlsx/odt/docx),
   `\xd0\xcf\x11\xe0` (old Office), `\x1f\x8b` (gzip), TIFF/PNG/JPEG headers,
   MATLAB `MATLAB 5.0 MAT-file`.
2. **text sniffing** for extension-less files — this is what fixes OpenFOAM and
   any other dictionary-driven code without naming the domain:
   - header `FoamFile` or a line `/*--------------------------------*- C++ -*---…` → `dict`
     (OpenFOAM, but also any C++-style header block);
   - `key value;` lines with `{ … }` nesting and no commas → `dict`;
   - a first line with ≥2 of `, ; \t |` and equal column counts on the next 3 lines → `table`;
   - `KEY = value` groups (`[section]`, `# comment`) → `config`;
   - otherwise → `text`.
3. **extension table** — the fallback, now only for what sniffing did not settle.
4. **path context**, applied by the pack layer (§3): a file named `p` inside a
   directory that a pack marked `case-time` is a `field`; the same name in `src/`
   is `code`.

**Level 2 — what is this directory?** (`role`), a *universal* vocabulary:

| role | universal test (evidence, not names) | plan reaction |
| --- | --- | --- |
| `run` | contains a config *and* a result (log/table/fields/time dirs), or an input and an output pair | never moves; becomes a `runs/<id>` candidate only in `restructure` |
| `raw-data` | pristine instrument exports: images, `.raw`, `.tif`, big binaries, nothing derivable | read-only, protected |
| `derived` | files whose name or header derives from another (processed, filtered, cropped) | work here |
| `analysis` | code/notebooks that read data and write tables/figures | counted, linked from the journal |
| `paper` | `.tex`, `.docx`, `\title{}`, `refs`+figure directories | never moves |
| `literature` | `.bib` + PDFs, or >N PDFs and no data | indexed into `literature/refs` |
| `talks` | `.pptx`/`.odp`, poster PDFs | listed |
| `admin` | grants, invoices, scans of forms, `.pdf` with "invoice/contract/act" in the name or text | listed, never analysed |
| `archive` | zip/tar, `backup`/`copy`/`old` in name or a copy of another tree | flagged, not deleted |
| `empty` | no files anywhere below | reported, never deleted |

Roles come from **which files exist**, never from the folder name alone. A name
can only *raise* the prior; the evidence decides. That is why an experiment
folder `2024-05-12_probe-3/` (csv + tif + pdf protocol) is recognised as a `run`
without anyone writing a rule about the language of the folder name.

## 3. Packs: the domain-specific half, as data

A **pack** is a JSON file, no code:

```json
{
  "id": "openfoam",
  "title": "OpenFOAM / CFD case",
  "match": {
    "files": ["system/controlDict", "constant/polyMesh/points"],
    "kinds": { "dict": 3, "field": 5 }
  },
  "kinds": {
    "extensions": { "cgns": "mesh", "obj": "geometry", "foam": "case", "plt": "post" },
    "names": { "controlDict": "dict", "fvSchemes": "dict", "polyMesh": "mesh" }
  },
  "dirs": {
    "case-time": { "parentHas": "system", "nameMatches": "^(0|[0-9]+(\\.[0-9]+)?)$", "role": "run" },
    "processor": { "nameMatches": "^processor[0-9]+$", "role": "run", "excludeFromNotable": true }
  },
  "wording": { "run": "run", "raw-data": "solution fields" }
}
```

Three packs ship in the box, chosen because each is a different *shape* of work:

- `numeric-openfoam.json` — case/time/processor structure;
- `experiment.json` — session folders, instrument exports, protocols, photos;
- `custom-code.json` — `src/` + `inputs/` + `out.dat`, Fortran/C/Python builds;
- `literature.json` — `.bib` + `refs/` + notes, no data at all;
- `generic.json` — always active, magic + sniffing + role vocabulary only.

A colleague adds `my-domain.json` next to these, or drops it into
`<project>/.dsh/packs/`, and `project_survey` picks it up. Nothing to rebuild.

## 4. Detection, reported honestly

`project_survey` returns, per pack: matched files, share of the tree, and the
three strongest evidences:

```
looks like: numeric-openfoam 74% (system/controlDict ×12, time directories ×1180,
           .cas.h5 ×9) · experiment 9% (Table_experiment_data_*.xlsx,
           *.tif under data/) · literature 3% (.bib + 312 pdf)
```

Rules:

- packs are additive — a mixed project gets both roles and both wordings;
- if nothing matches above 5 %, the report says **"domain not determined"** and stays
  with the generic vocabulary — that is a valid, honest answer;
- unknown names are not silently `other`: the map keeps
  `unknownNames: [{name, count, parent}]`, and the report prints the top 20 with
  "propose a rule" next to each. That list is how a colleague's domain gets
  supported without anyone guessing. (`.cgns` — 4 048 files — was found exactly
  this way.)

## 5. Canonical skeleton, adapted to the packs

The plan creates directories by **role coverage**, not by a fixed list:

1. always: `paper/`, `admin/`, `.dsh/`;
2. if `run` role exists or a numerical/code pack matched: `runs/`, `models/`;
3. if `raw-data` exists: `data/raw/` (protected) + `data/derived/`;
4. if `analysis` exists or code pack matched: `analysis/{scripts,figures,tables}`;
5. if `literature` exists or literature pack matched: `literature/{refs,notes}` + `_INDEX.md`;
6. if `talks` exists: `talks/`.

Consequence: a literature-only folder gets `paper/`, `literature/`, `analysis/`
(where the synthesis script lives) and **no empty `runs/`**; an experiment folder
gets `data/raw`, `runs/` (sessions), `analysis/`; a CFD case gets everything.
The three modes (`as-is`, `light`, `restructure`) stay unchanged — what changes is
only *which* directories `light` considers standard.

## 6. What stays fixed regardless of domain

These are the invariants a colleague's field does not change:

1. nothing is moved, renamed or deleted by the tool — ever;
2. `data/raw/**` is read-only, derivations live under `data/derived/` or `runs/`;
3. every plan states its own limits (`truncated`, unmatched packs, unknown names);
4. facts are separated from guesses, and a guess is marked as such;
5. the journal stays ≤64 KB and readable in a minute; lists go to json;
6. a "run" is evidence-based: config + result, not a folder called `run`;
7. the same scan is reproducible: same tree, same map, same counts.

## 7. Test corpus for universality

My 21 projects are a **regression corpus for the CFD-heavy shape**, not a proof of
universality. The model needs fixtures for the other three archetypes before the
skill is published:

| fixture | what it must prove |
| --- | --- |
| `exp-session/` — `2024-05-12_probe-3/{settings.txt, raw.csv, photos/*.jpg, protocol.pdf}` | recognised as `run` + `raw-data`, protocol as `document`, no `runs/` duplication |
| `lit-only/` — `refs/*.pdf`, `library.bib`, `notes/*.md`, `draft.tex` | literature pack wins, `runs/` and `models/` are not created |
| `custom-code/` — `src/*.f90`, `Makefile`, `inputs/case.in`, `out/out.dat`, `scripts/plot.py` | `run` = inputs+out, `analysis` = scripts, code pack matched |
| `mixed/` — CFD case + `.xlsx` measurements + `article/` | two packs matched, shares reported, both wordings used |
| `unknown/` — `.cgns`, `.plt`, `.water`, extension-less `.dat`-like text | magic/sniffing classifies or the top-20 unknown list names them |

Each fixture asserts roles, kinds, plan contents and the "no empty standard
directory" rule. Together with the 21 real projects that is both universality and
reality.
