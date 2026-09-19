"""
Where the pipeline reads and writes, resolved from this file's own location.

Every stage used to carry absolute paths from the machine it was first written
on, which made the run order in the README a lie: the commands were there, but
they could only work in one home directory. Anchoring on `__file__` means a
clone runs unchanged, and `--raw` / `--out` are there for the case where the
inputs genuinely live somewhere else.

`raw/` and `build/` are both ignored by git apart from the one compressed CSV
the application loads, because the intermediate GeoJSON is 15 MB and
reproducible from the sources by definition.
"""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
BUILD = ROOT / "build"

# Named here rather than spelled out in each stage, so a rename is one edit and
# the stages cannot disagree about what the file between them is called.
BLOCK_GROUPS = BUILD / "blockgroups.geojson"
ANALYZED = BUILD / "blockgroups_analyzed.geojson"
TABLE = BUILD / "block_groups.csv.gz"


def parser(description: str) -> argparse.ArgumentParser:
    """An argument parser with the paths every stage might want to override."""
    p = argparse.ArgumentParser(description=description)
    p.add_argument(
        "--raw",
        type=Path,
        default=RAW,
        metavar="DIR",
        help=f"directory holding the downloaded sources (default: {RAW.relative_to(ROOT)}/)",
    )
    p.add_argument(
        "--build",
        type=Path,
        default=BUILD,
        metavar="DIR",
        help=f"directory for intermediate and output files (default: {BUILD.relative_to(ROOT)}/)",
    )
    return p


def require(path: Path, hint: str) -> Path:
    """Fail with the missing filename and what produces it, not a traceback."""
    if not path.exists():
        raise SystemExit(f"missing {path}\n  {hint}")
    return path
