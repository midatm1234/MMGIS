<#
.SYNOPSIS
    Start, stop and restart MMGIS with the FROZON mission.

.DESCRIPTION
    MMGIS starts TiTiler-pgSTAC itself (adjacent-servers.js, gated on
    WITH_TITILER_PGSTAC), so this script only launches MMGIS - both services come
    up together. The SFNO forecast layers need TiTiler-pgSTAC, so the script
    health-checks it too and says so if it did not come up.

    Code changes are picked up automatically:
      * plugin manifests are re-activated, which regenerates src/pre/tools.js and
        configure/public/toolConfigs.json;
      * in production mode the frontend bundle is rebuilt when any source file is
        newer than the last build;
      * in dev mode (-Dev) webpack-dev-server hot-reloads the frontend, while the
        watcher restarts MMGIS for backend changes in any installed plugin.

.PARAMETER Stop
    Terminate MMGIS and TiTiler-pgSTAC, then exit.

.PARAMETER Restart
    Terminate both, then start again.

.PARAMETER Dev
    Run with NODE_ENV=development. The frontend is then served by
    webpack-dev-server on Port + 1 with hot reloading.

.PARAMETER Rebuild
    Force `npm run build` even if the bundle looks current.

.PARAMETER SkipBuild
    Never build, even if the bundle is stale. Useful for a fast backend-only restart.

.PARAMETER Watch
    Stay in the foreground and restart MMGIS whenever backend source changes.

.EXAMPLE
    .\start-frozon.ps1
    Rebuild if needed and start on http://localhost:8891/

.EXAMPLE
    .\start-frozon.ps1 -Dev
    Start with hot reloading on http://localhost:8892/

.EXAMPLE
    .\start-frozon.ps1 -Stop
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Dev,
    [switch]$Rebuild,
    [switch]$SkipBuild,
    [switch]$Watch,

    [int]$Port = 8891,

    # Database. Override if your local Postgres differs.
    [string]$DbHost = 'localhost',
    [int]$DbPort = 5432,
    [string]$DbName = 'mmgis',
    [string]$DbUser = 'mmgis',
    [string]$DbPass = 'mmgis',

    # Interpreter used for the adjacent Python servers. Defaults to the `mmgis`
    # mamba env, which is where GDAL/rasterio/titiler-pgstac live.
    [string]$AdjacentPython = "$env:LOCALAPPDATA\miniforge3\envs\mmgis\python.exe",

    # The mission config MMGIS loads instead of reading one from the database.
    # Repo-relative with forward slashes - it is fetched as a URL, not a file path.
    [string]$ForceConfigPath = 'Missions/frozon_ai_forecast_v38_config.json',
    [string]$MainMission = 'frozon'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$LogFile = Join-Path $RepoRoot 'frozon-mmgis.log'
$BuildStamp = Join-Path $RepoRoot '.frozon-build-stamp'

# MMGIS on $Port (plus $Port+1 for webpack-dev-server) and TiTiler-pgSTAC on 8884.
$TitilerPort = if ($env:TITILER_PGSTAC_PORT) { [int]$env:TITILER_PGSTAC_PORT } else { 8884 }

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "  ! $Message" -ForegroundColor Yellow }
function Write-Ok   { param([string]$Message) Write-Host "  + $Message" -ForegroundColor Green }

function Stop-OnPort {
    <#  Kill whatever listens on a port, with its children.

        The process tree is node -> cmd -> python, and TiTiler-pgSTAC forks
        several uvicorn workers, so killing only the listener leaves the port
        held and the next start dies with EADDRINUSE. taskkill /T takes the tree.
    #>
    param([int]$PortNumber, [string]$Label)

    $owners = @()
    try {
        $owners = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    } catch {
        return $false   # nothing listening
    }

    $killed = $false
    foreach ($processId in $owners) {
        if (-not $processId -or $processId -eq 0) { continue }
        $name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
        Write-Host "  stopping $Label (PID $processId $name)"
        taskkill /PID $processId /T /F 2>&1 | Out-Null
        $killed = $true
    }
    return $killed
}

function Stop-Services {
    Write-Step 'Stopping MMGIS and TiTiler-pgSTAC'
    $any = $false
    foreach ($p in @(@{Port=$Port; Label='MMGIS'},
                     @{Port=($Port + 1); Label='webpack-dev-server'},
                     @{Port=$TitilerPort; Label='TiTiler-pgSTAC'})) {
        if (Stop-OnPort -PortNumber $p.Port -Label $p.Label) { $any = $true }
    }
    if ($any) {
        Start-Sleep -Seconds 4
        Write-Ok 'Stopped.'
    } else {
        Write-Host '  nothing was running.'
    }
}

function Test-Endpoint {
    param([string]$Url, [int]$TimeoutSec = 5)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return [int]$r.StatusCode
    } catch {
        # A 4xx still proves something is listening and answering.
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Get-NewestSourceWrite {
    <#  Newest write time across everything that ends up in the bundle. Used to
        decide whether the build is stale.  #>
    $roots = @('src', 'plugins', 'configuration', 'public') |
        ForEach-Object { Join-Path $RepoRoot $_ } |
        Where-Object { Test-Path $_ }

    $newest = [datetime]::MinValue
    foreach ($root in $roots) {
        $f = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        if ($f -and $f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc }
    }
    foreach ($file in @('package.json')) {
        $p = Join-Path $RepoRoot $file
        if (Test-Path $p) {
            $t = (Get-Item $p).LastWriteTimeUtc
            if ($t -gt $newest) { $newest = $t }
        }
    }
    return $newest
}

function Invoke-Npm {
    param([string[]]$NpmArgs, [string]$What)
    Write-Host "  npm $($NpmArgs -join ' ')"
    & npm.cmd @NpmArgs 2>&1 | ForEach-Object { "    $_" } | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "$What failed (npm exit $LASTEXITCODE)" }
}

function Sync-Code {
    <#  Bring generated artifacts in line with the working tree.

        `plugins activate` is always safe to re-run and is what picks up an
        added/changed/removed plugin. The bundle rebuild is skipped in dev mode
        because webpack-dev-server compiles from source on the fly.  #>
    Write-Step 'Syncing code changes'

    Invoke-Npm -NpmArgs @('run', 'plugins', '--', 'activate') -What 'Plugin activation'
    Write-Ok 'Plugin registries regenerated.'

    $copilotTool = Join-Path $RepoRoot 'plugins\NASA-AMMOS--MMGIS-Plugins\tools\AgentChat\plugin.json'
    $copilotBackend = Join-Path $RepoRoot 'plugins\NASA-AMMOS--MMGIS-Plugins\backend\Agent\plugin.json'
    if (-not (Test-Path $copilotTool) -or -not (Test-Path $copilotBackend)) {
        Write-Warn 'The MMGIS-Plugins AgentChat tool and Agent backend are not both installed.'
        Write-Warn 'Install them with: npm run plugins -- install MMGIS-Plugins'
        Write-Warn 'The Frozon map can still start, but Copilot will be unavailable.'
    }

    if ($Dev) {
        Write-Host '  dev mode: webpack-dev-server compiles from source, no build needed.'
        return
    }
    if ($SkipBuild) {
        Write-Warn 'SkipBuild set - serving whatever is in build/ already.'
        return
    }

    $newestSource = Get-NewestSourceWrite
    $lastBuild = [datetime]::MinValue
    if (Test-Path $BuildStamp) { $lastBuild = (Get-Item $BuildStamp).LastWriteTimeUtc }
    $bundleMissing = -not (Test-Path (Join-Path $RepoRoot 'build\index.html'))

    if ($Rebuild -or $bundleMissing -or $newestSource -gt $lastBuild) {
        $reason = 'source newer than last build'
        if ($Rebuild) { $reason = 'forced' }
        elseif ($bundleMissing) { $reason = 'no bundle in build/' }
        Write-Host "  building frontend ($reason) - this takes a few minutes"
        Invoke-Npm -NpmArgs @('run', 'build') -What 'Frontend build'
        Set-Content -Path $BuildStamp -Value (Get-Date -Format 'o') -Encoding ascii
        Write-Ok 'Frontend rebuilt.'
    } else {
        Write-Ok 'Bundle is current, skipping build.'
    }
}

function Set-Environment {
    # dotenv does not overwrite variables that are already set, so these win over
    # .env - which still carries sample placeholders for the database and SECRET.
    $env:NODE_ENV = if ($Dev) { 'development' } else { 'production' }
    $env:PORT = "$Port"

    $env:DB_HOST = $DbHost
    $env:DB_PORT = "$DbPort"
    $env:DB_NAME = $DbName
    $env:DB_USER = $DbUser
    $env:DB_PASS = $DbPass
    $env:DB_SSL = 'false'
    # The test suite reads these.
    if (-not $env:DB_USER_TEST) { $env:DB_USER_TEST = $DbUser }
    if (-not $env:DB_PASS_TEST) { $env:DB_PASS_TEST = $DbPass }

    $env:FORCE_CONFIG_PATH = $ForceConfigPath
    $env:MAIN_MISSION = $MainMission

    # The server refuses to start with a SECRET under 24 characters, and .env has
    # the placeholder. Generating one per run means sessions do not survive a
    # restart - set a real SECRET in .env to keep them.
    if (-not $env:SECRET -or $env:SECRET.Length -lt 24) {
        # RandomNumberGenerator::Fill is .NET Core only; this works on PS 5.1 too.
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $env:SECRET = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        Write-Warn 'Generated a temporary SECRET; logins will not persist across restarts.'
    }

    # Only titiler-pgstac is provisioned. The others are enabled in .env but have
    # no Python packages installed, and would just log a failure on every start.
    $env:WITH_TITILER_PGSTAC = 'true'
    $env:WITH_STAC = 'false'
    $env:WITH_TIPG = 'false'
    $env:WITH_TITILER = 'false'
    $env:WITH_VELOSERVER = 'false'

    if (Test-Path $AdjacentPython) {
        $env:ADJACENT_SERVERS_PYTHON = $AdjacentPython
    } else {
        Write-Warn "No interpreter at $AdjacentPython"
        Write-Warn 'TiTiler-pgSTAC will fall back to the system python and probably fail,'
        Write-Warn 'which leaves the SFNO forecast layers blank. See FROZON-SETUP.md.'
    }
}

function Start-Services {
    Set-Environment

    Write-Step "Starting MMGIS (NODE_ENV=$($env:NODE_ENV), port $Port)"
    if (Test-Path $LogFile) { Remove-Item $LogFile -Force }

    # npm start = init-db.js (idempotent) then server.js, which spawns TiTiler-pgSTAC.
    $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' `
        -WorkingDirectory $RepoRoot -PassThru `
        -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err" `
        -WindowStyle Hidden
    Write-Host "  npm PID $($proc.Id), logging to $LogFile"

    $appUrl = if ($Dev) { "http://localhost:$($Port + 1)/" } else { "http://localhost:$Port/" }

    Write-Host '  waiting for MMGIS' -NoNewline
    $mmgisCode = 0
    foreach ($i in 1..90) {
        Start-Sleep -Seconds 2
        $mmgisCode = Test-Endpoint -Url $appUrl
        if ($mmgisCode -ge 200) { break }
        Write-Host '.' -NoNewline
    }
    Write-Host ''

    if ($mmgisCode -lt 200) {
        Write-Warn "MMGIS did not answer on $appUrl"
        if (Test-Path "$LogFile.err") { Get-Content "$LogFile.err" -Tail 20 | ForEach-Object { "    $_" } }
        elseif (Test-Path $LogFile) { Get-Content $LogFile -Tail 20 | ForEach-Object { "    $_" } }
        throw 'MMGIS failed to start.'
    }
    Write-Ok "MMGIS is up:  $appUrl  (HTTP $mmgisCode)"

    # TiTiler-pgSTAC is slower to bind than MMGIS; it loads GDAL and forks workers.
    Write-Host '  waiting for TiTiler-pgSTAC' -NoNewline
    $titilerCode = 0
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 2
        $titilerCode = Test-Endpoint -Url "http://localhost:$TitilerPort/healthz"
        if ($titilerCode -ge 200) { break }
        Write-Host '.' -NoNewline
    }
    Write-Host ''

    if ($titilerCode -ge 200) {
        Write-Ok "TiTiler-pgSTAC is up: http://localhost:$TitilerPort/  (HTTP $titilerCode)"
    } else {
        Write-Warn "TiTiler-pgSTAC is not answering on port $TitilerPort."
        Write-Warn 'The SFNO forecast layers will be blank. See FROZON-SETUP.md.'
    }

    Write-Host ''
    Write-Host "  Mission config: $ForceConfigPath" -ForegroundColor DarkGray
    Write-Host "  Mission data:   $(Join-Path $RepoRoot 'Missions')" -ForegroundColor DarkGray
    Write-Host "  Stop with:      .\start-frozon.ps1 -Stop" -ForegroundColor DarkGray
    Write-Host ''
    Write-Host "  The mission opens at 2023-01-02, before the first indexed raster," -ForegroundColor DarkGray
    Write-Host "  so move the timeline into 2023-01-04 .. 2024-12-31 to see SFNO data." -ForegroundColor DarkGray
}

function Start-WatchLoop {
    <#  Restart on backend changes. Frontend changes in dev mode are hot-reloaded
        by webpack, so only server-side trees are watched here.  #>
    $watched = @('scripts', 'API', 'adjacent-servers') |
        ForEach-Object { Join-Path $RepoRoot $_ } |
        Where-Object { Test-Path $_ }
    $pluginRoot = Join-Path $RepoRoot 'plugins'
    if (Test-Path $pluginRoot) {
        $watched += Get-ChildItem -Path $pluginRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'backend' } |
            Where-Object { Test-Path $_ }
    }
    $watched = $watched | Where-Object { Test-Path $_ }

    Write-Step 'Watching for changes (Ctrl+C to stop)'
    $watched | ForEach-Object { Write-Host "  watching $_" }

    $watchers = @()
    $script:changed = $false
    foreach ($dir in $watched) {
        $w = New-Object System.IO.FileSystemWatcher $dir, '*.js'
        $w.IncludeSubdirectories = $true
        $w.EnableRaisingEvents = $true
        foreach ($evt in 'Changed', 'Created', 'Deleted', 'Renamed') {
            Register-ObjectEvent -InputObject $w -EventName $evt -Action {
                $script:changed = $true
            } | Out-Null
        }
        $watchers += $w
    }

    try {
        while ($true) {
            Start-Sleep -Seconds 2
            if ($script:changed) {
                # Let a burst of saves settle before restarting.
                Start-Sleep -Seconds 3
                $script:changed = $false
                Write-Host ''
                Write-Step 'Change detected - restarting'
                Stop-Services
                Sync-Code
                Start-Services
            }
        }
    } finally {
        $watchers | ForEach-Object { $_.EnableRaisingEvents = $false; $_.Dispose() }
        Get-EventSubscriber | Unregister-Event -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------

Push-Location $RepoRoot
try {
    if ($Stop) { Stop-Services; return }

    if ($Restart) { Stop-Services }
    else {
        # Never leave an orphan holding the port - that is what causes EADDRINUSE.
        foreach ($p in @($Port, ($Port + 1), $TitilerPort)) {
            if (Stop-OnPort -PortNumber $p -Label "existing listener on $p") {
                Write-Warn "Reclaimed port $p from a previous run."
                Start-Sleep -Seconds 3
            }
        }
    }

    Sync-Code
    Start-Services

    if ($Watch) { Start-WatchLoop }
} finally {
    Pop-Location
}
