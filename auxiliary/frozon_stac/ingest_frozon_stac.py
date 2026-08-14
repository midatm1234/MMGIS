"""Ingest the FROZON sea-ice GeoTIFFs into pgSTAC so titiler-pgstac can mosaic them.

The mission config's two forecast layers are `sourceType: "stac-collection"`, so
MMGIS asks titiler-pgstac for
`/collections/<collection>/tiles/<tileMatrixSet>/{z}/{x}/{y}?assets=asset&datetime=<range>`.
Nothing renders until pgSTAC holds a collection per layer and one item per daily
raster. This script builds that from whatever is on disk.

Two names are load-bearing and must not drift:

* the **collection id** must equal the layer's `url` in the mission config
  (`forecast-7day-PRED` / `forecast-7day-GRND`), because that is what MMGIS puts
  in the tile path;
* the **asset key** must be `asset`, because the config requests `assets=asset`
  and its `cogExpression` is `(asset_b1*100)` — i.e. band 1 of the asset named
  `asset`.

Item hrefs are absolute local paths, so they are only valid for one location of
the mission data. Re-run this after moving `Missions/`.

Usage (from the repo root, inside the `mmgis` env):

    python auxiliary/frozon_stac/ingest_frozon_stac.py \
        --dsn postgresql://mmgis:mmgis@localhost:5432/mmgis-stac

Add `--dry-run` to write the NDJSON and skip the database entirely.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import rasterio
from rasterio.warp import transform_bounds

# Layer directory -> collection id. The collection id is what the mission config
# carries as the layer's `url`.
LAYERS = {
    "forecast-7day-PRED": {
        "dir": "forecast-7day-PRED",
        "title": "SFNO Prediction Daily 10 km",
        "description": (
            "SFNO-predicted daily sea ice concentration, 10 km, "
            "derived from NSIDC SICONC."
        ),
    },
    "forecast-7day-GRND": {
        "dir": "forecast-7day-GRND",
        "title": "SFNO Ground Truth Daily 10 km",
        "description": (
            "NSIDC SICONC daily sea ice concentration ground truth, 10 km."
        ),
    },
}

ASSET_KEY = "asset"
# NSIDC_SICONC_AI_PRED_20230104.tif -> 20230104
DATE_RE = re.compile(r"_(\d{8})\.tif$", re.IGNORECASE)


def item_datetime(filename):
    m = DATE_RE.search(filename)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y%m%d").replace(tzinfo=timezone.utc)


def build_item(collection_id, path, dt):
    """One STAC item per raster, with its footprint in EPSG:4326."""
    with rasterio.open(path) as src:
        # pgSTAC indexes geometry in 4326 regardless of the raster's own CRS.
        west, south, east, north = transform_bounds(
            src.crs, "EPSG:4326", *src.bounds, densify_pts=21
        )
        epsg = src.crs.to_epsg() if src.crs else None
        bands = src.count

    bbox = [west, south, east, north]
    href = os.path.abspath(path).replace("\\", "/")
    stamp = dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": os.path.splitext(os.path.basename(path))[0],
        "collection": collection_id,
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [west, south],
                    [east, south],
                    [east, north],
                    [west, north],
                    [west, south],
                ]
            ],
        },
        "bbox": bbox,
        "properties": {
            "datetime": stamp,
            "proj:epsg": epsg,
        },
        "assets": {
            ASSET_KEY: {
                "href": href,
                "type": "image/tiff; application=geotiff",
                "roles": ["data"],
                "raster:bands": [{"nodata": None} for _ in range(bands)],
            }
        },
        "links": [],
        "stac_extensions": [],
    }


def build_collection(collection_id, meta, bbox, start, end):
    return {
        "type": "Collection",
        "stac_version": "1.0.0",
        "id": collection_id,
        "title": meta["title"],
        "description": meta["description"],
        "license": "proprietary",
        "extent": {
            "spatial": {"bbox": [bbox]},
            "temporal": {
                "interval": [
                    [
                        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    ]
                ]
            },
        },
        "links": [],
        "stac_extensions": [],
    }


def pypgstac_load(dsn, kind, path):
    """`pypgstac load` upserts, so re-running this script is safe."""
    cmd = [
        sys.executable,
        "-m",
        "pypgstac.pypgstac",
        "load",
        kind,
        path,
        "--dsn",
        dsn,
        "--method",
        "upsert",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout + proc.stderr)
        raise SystemExit(f"pypgstac load {kind} failed ({proc.returncode})")
    return proc.stdout.strip()


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--layers-root",
        default=os.path.join(repo_root, "Missions", "frozon", "Layers"),
        help="directory holding the forecast-7day-* folders",
    )
    ap.add_argument("--dsn", default=os.environ.get("PGSTAC_DSN"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.dry_run and not args.dsn:
        raise SystemExit("--dsn (or PGSTAC_DSN) is required unless --dry-run")

    outdir = tempfile.mkdtemp(prefix="frozon-stac-")
    collections, totals = [], {}

    for collection_id, meta in LAYERS.items():
        src_dir = os.path.join(args.layers_root, meta["dir"])
        if not os.path.isdir(src_dir):
            print(f"  ! {collection_id}: {src_dir} not found, skipping")
            continue

        items, skipped = [], 0
        for name in sorted(os.listdir(src_dir)):
            if not name.lower().endswith(".tif"):
                continue
            dt = item_datetime(name)
            if dt is None:
                skipped += 1
                continue
            items.append(build_item(collection_id, os.path.join(src_dir, name), dt))

        if not items:
            print(f"  ! {collection_id}: no dated .tif files, skipping")
            continue

        # Union of item footprints and the full time span.
        bbox = [
            min(i["bbox"][0] for i in items),
            min(i["bbox"][1] for i in items),
            max(i["bbox"][2] for i in items),
            max(i["bbox"][3] for i in items),
        ]
        stamps = [i["properties"]["datetime"] for i in items]
        start = datetime.strptime(min(stamps), "%Y-%m-%dT%H:%M:%SZ")
        end = datetime.strptime(max(stamps), "%Y-%m-%dT%H:%M:%SZ")

        collections.append(build_collection(collection_id, meta, bbox, start, end))

        items_path = os.path.join(outdir, f"{collection_id}.items.ndjson")
        with open(items_path, "w", encoding="utf-8") as fh:
            for item in items:
                fh.write(json.dumps(item) + "\n")

        totals[collection_id] = {
            "items": len(items),
            "skipped": skipped,
            "path": items_path,
            "range": (min(stamps), max(stamps)),
            "bbox": [round(v, 3) for v in bbox],
        }
        print(
            f"  {collection_id}: {len(items)} items "
            f"({min(stamps)[:10]} .. {max(stamps)[:10]}), "
            f"bbox={[round(v, 2) for v in bbox]}"
            + (f", {skipped} undated file(s) skipped" if skipped else "")
        )

    if not collections:
        raise SystemExit("nothing to ingest")

    coll_path = os.path.join(outdir, "collections.ndjson")
    with open(coll_path, "w", encoding="utf-8") as fh:
        for c in collections:
            fh.write(json.dumps(c) + "\n")

    if args.dry_run:
        print(f"\ndry run — NDJSON written to {outdir}")
        return

    # Collections must land before their items.
    print("\nloading collections...")
    pypgstac_load(args.dsn, "collections", coll_path)
    for collection_id, info in totals.items():
        print(f"loading {info['items']} items for {collection_id}...")
        pypgstac_load(args.dsn, "items", info["path"])

    print("\ndone.")


if __name__ == "__main__":
    main()
