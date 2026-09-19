"""
Where the pipeline reads and writes, resolved from this file's own location.

Every stage used to carry absolute paths from the machine it was first written
on, which made the run order in the README a lie: the commands were there, but
they could only work in one home directory. Anchoring on `__file__` means a
clone runs unchanged, and `--raw` / `--out` are there for the case where the
inputs genuinely live somewhere else.

`raw/` and `build/` are both ignored by git apart from the one compressed CSV
the application loads, because the intermediate GeoJSON is 15 MB and
reproducible from the sources by definition. That one exception is a build
artefact in source control, which is a thing worth being deliberate about —
see docs/decisions/0009-derived-data-in-git.md, and the manifest below, which
is what makes a regeneration of it a visible act rather than a silent one.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
BUILD = ROOT / "build"

# Named here rather than spelled out in each stage, so a rename is one edit and
# the stages cannot disagree about what the file between them is called.
BLOCK_GROUPS = BUILD / "blockgroups.geojson"
ANALYZED = BUILD / "blockgroups_analyzed.geojson"
TABLE = BUILD / "block_groups.csv.gz"
MANIFEST = BUILD / "block_groups.manifest.json"


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


def _digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(table: Path, manifest: Path, rows: int) -> dict:
    """
    Record what was built, next to the thing that was built.

    The table is a 3.6 MB build artefact kept in source control so that a
    clone can load the database without re-running the whole pipeline. The
    manifest is what keeps that honest: it is small, it is diffable, and it
    means regenerating the table shows up in review as a changed checksum and
    a changed row count rather than as "binary file modified".

    It is also a cheap integrity check at load time. A truncated download or a
    partially written file is otherwise discovered as a COPY that fails
    halfway through, or — worse — as one that succeeds with fewer rows than
    the county has.
    """
    payload = {
        "file": table.name,
        "rows": rows,
        "bytes": table.stat().st_size,
        "sha256": _digest(table),
        "columns": gzip.open(table, "rt").readline().strip().split(","),
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    manifest.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def verify_manifest(table: Path, manifest: Path) -> dict:
    """
    Check a table against its manifest, or say plainly that there isn't one.

    A missing manifest is not fatal: someone may be loading a table they built
    a moment ago in a working tree, and refusing that would make the check an
    obstacle rather than a guard. A manifest that disagrees *is* fatal, because
    the only ways to get here are a corrupted file and a table rebuilt without
    its manifest, and both should stop before touching a database.
    """
    if not manifest.exists():
        return {"checked": False, "reason": f"no {manifest.name}"}

    expected = json.loads(manifest.read_text())
    actual = _digest(table)
    if actual != expected["sha256"]:
        raise SystemExit(
            f"{table.name} does not match {manifest.name}\n"
            f"  expected sha256 {expected['sha256']}\n"
            f"  actual   sha256 {actual}\n"
            "  rebuild both with pipeline/analyze.py, or restore the committed file"
        )
    return {"checked": True, **expected}
