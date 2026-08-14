#!/bin/bash
###############################################################################
# TiTiler-pgSTAC
#
# Set ADJACENT_SERVERS_PYTHON to a specific interpreter (for example a conda or
# mamba env's python) to run this server off an environment other than the
# `python` first on PATH. When it points into a conda-style env, that env's GDAL
# and PROJ data directories are exported too, which activation would normally do.
# Leave the variable unset for the old behavior.
if [ -n "$ADJACENT_SERVERS_PYTHON" ]; then
  PYEXE="$ADJACENT_SERVERS_PYTHON"
  PYHOME="$(dirname "$ADJACENT_SERVERS_PYTHON")"
  [ -z "$PROJ_DATA" ] && [ -d "$PYHOME/share/proj" ] && export PROJ_DATA="$PYHOME/share/proj"
  [ -z "$GDAL_DATA" ] && [ -d "$PYHOME/share/gdal" ] && export GDAL_DATA="$PYHOME/share/gdal"
else
  PYEXE="python"
fi

"$PYEXE" -m dotenv run "$PYEXE" -m uvicorn titiler.pgstac.main:app --port "$1"
