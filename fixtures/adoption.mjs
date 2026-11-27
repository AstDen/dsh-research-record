/**
 * Five trees that stand in for the projects this bundle has not seen.
 *
 * The benchmark that produced the 44 % "other" figure ran on one person's CFD
 * projects. A colleague may have nothing but measurements, nothing but sources,
 * a hand-written solver, a mixture of all three, or a tree whose conventions no
 * pack knows yet. These fixtures are the acceptance test for every universal
 * change: a rule that only helps OpenFOAM does not belong in the code.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const FIXTURES = {
  'exp-session': {
    'записи/серия_01/acquisition.xml': '<acquisition><frames>1200</frames></acquisition>',
    'записи/серия_01/scan_0001.lvm': 'x,y\n0,1\n1,2\n',
    'записи/серия_01/scan_0002.lvm': 'x,y\n0,1.1\n1,2.1\n',
    'записи/серия_01/scan_0003.lvm': 'x,y\n0,1.2\n1,2.2\n',
    'записи/калибровка/calibration.png': 'PNG-placeholder',
    'обработка/fit_curve.py': 'import numpy as np\n',
    'обработка/results.csv': 'u,dpdx\n0.1,1.2\n',
    'статья/draft.tex': '\\documentclass{article}\\title{Pressure drop in a porous tube}\n'
  },
  'lit-only': {
    'литература/pdfs/galowin1974.pdf': '%PDF-1.4 placeholder',
    'литература/pdfs/hager1987.pdf': '%PDF-1.4 placeholder',
    'литература/pdfs/ergun1952.pdf': '%PDF-1.4 placeholder',
    'литература/pdfs/dietrich1994.pdf': '%PDF-1.4 placeholder',
    'литература/pdfs/unknown2019.pdf': '%PDF-1.4 placeholder',
    'литература/library.bib': '@article{galowin1974,\n title={Investigation of laminar flow}\n}\n',
    'заметки/reading-log.md': '# Прочитано\n\n- Galowin 1974\n',
    'обзор/review.tex': '\\documentclass{article}\\title{Обзор пористого горения}\n'
  },
  'custom-code': {
    'src/solver.f90': 'program solver\nend program\n',
    'src/kernel.f90': 'subroutine kernel()\nend subroutine\n',
    'src/mesh.f90': 'subroutine mesh()\nend subroutine\n',
    'src/Makefile': 'FC=gfortran\nall:\n\t$(FC) -o solver solver.f90\n',
    'runs/case_a/input.dat': 'nx = 100\nny = 100\n',
    'runs/case_a/solver.log': 'iter 1 residual 1e-2\niter 2 residual 3e-3\n',
    'runs/case_a/output.csv': 'x,y,T\n0,0,300\n',
    'paper/main.tex': '\\documentclass{article}\\title{Custom solver}\n'
  },
  'mixed': {
    'эксперимент/2024_05_12/scan.lvm': 'x,y\n0,1\n',
    'расчёт/base/case.foam': 'placeholder',
    'расчёт/base/0/U': 'dimensions [0 1 -1 0 0 0 0];\n',
    'расчёт/base/0/p': 'dimensions [0 2 -2 0 0 0 0];\n',
    'расчёт/base/constant/polyMesh/points': '10\n(\n)\n',
    'расчёт/base/system/controlDict': 'FoamFile\n{\n    version 2.0;\n}\n',
    'литература/refs/paper.pdf': '%PDF-1.4 placeholder',
    'analysis/compare.py': 'import matplotlib\n'
  },
  unknown: {
    'данные/прибор_3/0001.sxm': 'binary-ish',
    'данные/прибор_3/0002.sxm': 'binary-ish',
    'данные/прибор_3/scan_params': 'gap 12.5 nm\nmode tapping\n',
    'probe/log_20240512': 'timestamp x y z\n1 2 3 4\n',
    'probe/reference_points': '1.0 2.0 3.0\n'
  }
}

export const FIXTURE_NAMES = Object.keys(FIXTURES)

/** Materialise every fixture under `root`; returns the created directories. */
export async function buildFixtures(root) {
  const created = []
  for (const [name, files] of Object.entries(FIXTURES)) {
    const base = join(root, name)
    created.push(base)
    for (const [path, content] of Object.entries(files)) {
      const target = join(base, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
  }
  return created
}

export default { FIXTURE_NAMES, buildFixtures }
