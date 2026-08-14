# FROZON MMGIS — local setup (Windows)

How this checkout is wired to the FROZON mission data. Everything here is
configuration; no mission files are copied into the repository.

## Mission data location

MMGIS always serves missions from **`<repo root>/Missions`**, resolved from the
install directory (`scripts/middleware.js` uses `${__dirname}/..`), not from the
shell's working directory. With the repo at `D:\MMGIS`, that is exactly:

```
D:\MMGIS\Missions
```

So the existing data is already in the only place MMGIS looks — there is no
separate "missions path" setting to point elsewhere, and none is needed here.
To relocate the data on another machine, move or symlink the `Missions`
directory next to the checkout (e.g. `mklink /D D:\MMGIS\Missions E:\data\Missions`).

Contents in use:

```
D:\MMGIS\Missions\
├── frozon_ai_forecast_v38_config.json     <- the mission config (see below)
└── frozon\Layers\
    ├── forecast-7day-GRND\ NSIDC_SICONC_AI_GRND_*.tif
    └── forecast-7day-PRED\ NSIDC_SICONC_AI_PRED_*.tif
```

## The one configuration value: `FORCE_CONFIG_PATH`

`Missions\frozon_ai_forecast_v38_config.json` is the only JSON under `Missions`,
and it is the one the launch workflow uses. It is selected by a single env var:

```
FORCE_CONFIG_PATH=Missions/frozon_ai_forecast_v38_config.json
```

With this set, MMGIS reads the mission config **from this file instead of the
database** (`src/App.js` → `LandingPage.init`). The value is fetched by the
browser over HTTP, so it must be:

- **relative to the repo root**, not absolute — `D:\MMGIS\Missions\...` will not resolve
- **forward slashes**, on Windows too

`MAIN_MISSION=frozon` then skips the landing page and opens the mission
directly. It matches `msv.mission` / `msv.missionFolderName` in the config, which
is what binds the config to `Missions\frozon\`.

The config was validated against this MMGIS version's own validator
(`plugins/core/backend/Config/validate.js`), which returns `{ valid: true }`.
**No changes were made to any file under `Missions\`.**

## Required `.env` values

`.env` already had `PORT`, `AUTH`, `FORCE_CONFIG_PATH` and `MAIN_MISSION` set
correctly. The database block and `SECRET` were still the untouched
`sample.env` placeholders and must be filled in:

```
SECRET=<random string, at least 24 characters — the server refuses to start otherwise>

DB_HOST=localhost
DB_PORT=5432
DB_NAME=mmgis
DB_USER=mmgis
DB_PASS=mmgis

# only needed to run the test suite
DB_USER_TEST=mmgis
DB_PASS_TEST=mmgis
```

`DB_PORT` was `54843`, which nothing listens on — the local PostgreSQL 18
instance is on `5432`.

## Install and launch (PowerShell)

```powershell
cd D:\MMGIS

# 1. Dependencies (postinstall also resolves plugin deps)
npm install

# 2. One-time database setup — role `mmgis`, databases `mmgis` and `mmgis-test`,
#    both with PostGIS. Skip if already done.
$env:PGPASSWORD = 'mmgis'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U mmgis -d mmgis -c 'SELECT postgis_version();'

# 3. Register plugins and regenerate the frontend registries
npm run plugins -- activate

# 4. Create schema (idempotent) and start
npm start
```

`npm start` runs `scripts/init-db.js` then `scripts/server.js`. With
`NODE_ENV=development` (the value in `.env`), webpack-dev-server serves the
frontend on **PORT + 1**, so browse:

```
http://localhost:8892/
```

For a production-style run against the prebuilt bundle:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start          # http://localhost:8891/
```

## Copilot (AgentChat)

The Copilot lives at [plugins/frozon/tools/AgentChat/](plugins/frozon/tools/AgentChat/)
and is enabled by the mission config's `tools` entry
`{ "name": "AgentChat", "js": "AgentChatTool" }`. Open it from the **Copilot**
button in the top bar.

It requires a backend serving `POST /api/agent` and `GET /api/agent/tools`,
which **is not part of MMGIS** — see
[plugins/frozon/README.md](plugins/frozon/README.md). Without it the panel opens
and reports `Agent is unavailable` when you send a message.

## SFNO forecast layers (TiTiler-pgSTAC)

The two `forecast-7day-*` layers are `sourceType: "stac-collection"`: MMGIS does
not read the GeoTIFFs directly, it asks TiTiler-pgSTAC to mosaic them per
timestamp from a pgSTAC index. Three things have to be in place.

### 1. Python environment

The stack (GDAL, rasterio, PROJ, titiler-pgstac, pypgstac) lives in a mamba env
named `mmgis` rather than the system Python:

```powershell
$mamba = "$env:LOCALAPPDATA\miniforge3\condabin\mamba.bat"
& $mamba create -y -n mmgis -c conda-forge python=3.12 rasterio pyproj psycopg pip uvicorn
$py = "$env:LOCALAPPDATA\miniforge3\envs\mmgis\python.exe"
& $py -m pip install "titiler.pgstac" pypgstac python-dotenv psycopg-pool
```

`psycopg-pool` is a real requirement of `pypgstac` that conda's `psycopg` does
not pull in.

Tell MMGIS to launch the adjacent servers with that interpreter — add to `.env`:

```
ADJACENT_SERVERS_PYTHON=C:\Users\<you>\AppData\Local\miniforge3\envs\mmgis\python.exe
```

The launcher derives `PROJ_DATA`, `GDAL_DATA` and the DLL path from it, which
activation would normally provide. Without them PROJ cannot find its database and
reprojection fails.

### 2. pgSTAC schema

`init-db.js` creates the `mmgis-stac` database but cannot conform it to pgstac,
so do it once. `CREATE EXTENSION postgis` and the migration need superuser, and
`PYTHONUTF8=1` is required because `pypgstac migrate` otherwise reads its own SQL
with the Windows cp1252 codec and dies on a `UnicodeDecodeError`:

```powershell
$env:PGPASSWORD = '<postgres password>'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d mmgis-stac `
    -c 'CREATE EXTENSION IF NOT EXISTS postgis;' -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;'

$env:PYTHONUTF8 = '1'
& $py -m pypgstac.pypgstac migrate --dsn 'postgresql://postgres@localhost:5432/mmgis-stac'

& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d mmgis-stac `
    -c 'GRANT pgstac_admin, pgstac_ingest, pgstac_read TO mmgis;'
```

### 3. Index the rasters

[auxiliary/frozon_stac/ingest_frozon_stac.py](auxiliary/frozon_stac/ingest_frozon_stac.py)
builds one STAC collection per layer directory and one item per daily GeoTIFF,
reading each footprint with rasterio. It **reads** `Missions/` and never writes to
it. Loads are upserts, so re-running is safe:

```powershell
& $py auxiliary\frozon_stac\ingest_frozon_stac.py --dsn 'postgresql://mmgis:mmgis@localhost:5432/mmgis-stac'
```

Current contents: `forecast-7day-PRED` 728 items (2023-01-04 … 2024-12-31),
`forecast-7day-GRND` 729 items (2023-01-03 … 2024-12-31).

Item asset hrefs are **absolute local paths**, so re-run this after moving the
mission data.

### Why nothing showed before

Three independent faults, all fixed in code rather than by editing the mission JSON:

1. **Band naming.** rio-tiler ≥ 9 exposes the merged bands as `b1..bN`, but MMGIS
   rewrote `bN` into `asset_bN`, which TiTiler rejects with
   400 `Invalid band/asset name` — so every tile failed. `normalizeCogExpression`
   in `LayerUtils.js` now normalizes to `bN` and accepts both spellings, so the
   config's `(asset_b1*100)` works untouched.
2. **The adjacent servers never started on Windows.** MSYS shells (git-bash, how
   `npm start` is normally run here) export `NoDefaultCurrentDirectoryInExePath=1`,
   and cmd.exe then will not resolve a bare `start-titiler-pgstac.bat` from the
   current directory. `adjacent-servers.js` now invokes it as `.\…bat`.
3. **Stale config names.** `adjacent-servers/titiler-pgstac/.env.example` still
   uses `POSTGRES_USER`/`POSTGRES_PASS`; titiler-pgstac 3.x reads `PG*`, so the
   password arrived as `None` and startup died in `quote_from_bytes`.

### Time range matters

The mission opens at 2023-01-02, which is *before* the first indexed item, so the
forecast layers are legitimately empty at the default view. Move the timeline to a
date in range (e.g. 2023-06-15) to see data. Tiles with no coverage return HTTP
204, which is normal.

## Known gaps

- **GIBS base layers need outbound internet** (`gibs.earthdata.nasa.gov`).
- Only `WITH_TITILER_PGSTAC` was set up. `WITH_STAC`, `WITH_TIPG`, `WITH_TITILER`
  and `WITH_VELOSERVER` are `true` in `.env` but their Python packages are not
  installed, so they log a failure and are otherwise inert. Set them to `false`
  or install each one's dependencies.
- **Copilot needs a backend** — see above.
