:: ###############################################################################
:: TiTiler-pgSTAC
::
:: Set ADJACENT_SERVERS_PYTHON to a specific interpreter (for example a conda or
:: mamba env's python.exe) to run this server off an environment other than the
:: `python` first on PATH. When it points into a conda-style env, that env's GDAL
:: and PROJ data directories and DLLs are added too — invoking such a python.exe
:: directly, without activating the env, otherwise leaves PROJ unable to find its
:: database and reprojection fails. Leave the variable unset for the old behavior.
@echo off
setlocal

if not defined ADJACENT_SERVERS_PYTHON goto :system_python

set "PYEXE=%ADJACENT_SERVERS_PYTHON%"
for %%I in ("%ADJACENT_SERVERS_PYTHON%") do set "PYHOME=%%~dpI"
if not defined PROJ_DATA if exist "%PYHOME%Library\share\proj" set "PROJ_DATA=%PYHOME%Library\share\proj"
if not defined GDAL_DATA if exist "%PYHOME%Library\share\gdal" set "GDAL_DATA=%PYHOME%Library\share\gdal"
if exist "%PYHOME%Library\bin" set "PATH=%PYHOME%Library\bin;%PYHOME%Scripts;%PATH%"
goto :run

:system_python
set "PYEXE=python"

:run
"%PYEXE%" -m dotenv run "%PYEXE%" -m uvicorn titiler.pgstac.main:app --port %1
