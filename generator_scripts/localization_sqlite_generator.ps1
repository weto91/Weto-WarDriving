# =============================================================================
# WETO Map Database Generator - Windows PowerShell
# Generates a SpatiaLite DB with street lines + cities
# Requires: wget (or curl), 7zip/unzip, ogr2ogr (GDAL), sqlite3
# =============================================================================

$BASE_URL     = "https://download.geofabrik.de"
$GEONAMES_URL = "https://download.geonames.org/export/dump/cities1000.zip"
$OUTPUT_DB    = "streets_custom.sqlite"
$WORK_DIR     = $PSScriptRoot

# Helper: check if a command exists
function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# Helper: exit with error
function Exit-Error($msg) {
    Write-Host "[!] $msg" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------------------
# PREREQUISITE CHECK
# -----------------------------------------------------------------------------
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "      WETO Map Database Generator      " -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[*] Checking prerequisites..." -ForegroundColor Yellow

$missing = @()
foreach ($tool in @("ogr2ogr", "sqlite3")) {
    if (-not (Test-Command $tool)) { $missing += $tool }
}
if ($missing.Count -gt 0) {
    Write-Host "[!] Missing tools: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "    Install GDAL:   https://gdal.org/download.html" -ForegroundColor Yellow
    Write-Host "    Install SQLite: https://sqlite.org/download.html" -ForegroundColor Yellow
    Write-Host "    Or via winget:" -ForegroundColor Yellow
    Write-Host "      winget install OSGeo.GDAL" -ForegroundColor Gray
    Write-Host "      winget install SQLite.SQLite" -ForegroundColor Gray
    exit 1
}

Write-Host "[OK] All prerequisites found." -ForegroundColor Green

# -----------------------------------------------------------------------------
# PART 1: STREETS (OpenStreetMap via Geofabrik)
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "[STREETS] Select continent (e.g., europe, north-america, south-america):"
$CONTINENT = Read-Host ">"

Write-Host "[STREETS] Select country (e.g., spain, france, germany, usa):"
$COUNTRY = Read-Host ">"

$URL      = "${BASE_URL}/${CONTINENT}/${COUNTRY}-latest.osm.pbf"
$PBF_FILE = Join-Path $WORK_DIR "${COUNTRY}-latest.osm.pbf"

Write-Host "[+] Downloading streets from: $URL" -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri $URL -OutFile $PBF_FILE -UseBasicParsing
} catch {
    Exit-Error "Could not download map file. Check names at download.geofabrik.de"
}

Write-Host "[+] Converting to SpatiaLite (table: lines)..." -ForegroundColor Yellow
& ogr2ogr -f SQLite -dsco SPATIALITE=YES $OUTPUT_DB $PBF_FILE `
    -nln lines `
    -sql "SELECT name, highway FROM lines WHERE highway IS NOT NULL AND name IS NOT NULL" `
    -lco GEOMETRY_NAME=GEOMETRY `
    -overwrite

if ($LASTEXITCODE -ne 0) {
    Remove-Item -Force $PBF_FILE -ErrorAction SilentlyContinue
    Exit-Error "ogr2ogr conversion failed."
}

Write-Host "[+] Cleaning up PBF file..." -ForegroundColor Yellow
Remove-Item -Force $PBF_FILE

# -----------------------------------------------------------------------------
# PART 2: CITIES (GeoNames cities1000)
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "[CITIES] Downloading GeoNames cities dataset..." -ForegroundColor Yellow

$ZIP_FILE = Join-Path $WORK_DIR "cities1000.zip"
$TXT_FILE = Join-Path $WORK_DIR "cities1000.txt"

try {
    Invoke-WebRequest -Uri $GEONAMES_URL -OutFile $ZIP_FILE -UseBasicParsing
} catch {
    Exit-Error "Could not download GeoNames dataset."
}

Write-Host "[+] Extracting..." -ForegroundColor Yellow
Expand-Archive -Path $ZIP_FILE -DestinationPath $WORK_DIR -Force

Write-Host "[+] Importing cities into database (table: cities)..." -ForegroundColor Yellow

# Create cities table
& sqlite3 $OUTPUT_DB @"
CREATE TABLE IF NOT EXISTS cities (
    lat    REAL,
    lon    REAL,
    name   TEXT,
    admin1 TEXT,
    admin2 TEXT,
    cc     TEXT
);
"@

# Parse TSV and insert rows in batches
# GeoNames columns: $2=name, $5=lat, $6=lon, $9=cc, $11=admin1, $12=admin2
Write-Host "[+] Parsing and inserting cities (this may take a moment)..." -ForegroundColor Yellow

$BATCH_SIZE  = 500
$batch       = [System.Text.StringBuilder]::new()
$count       = 0
$totalCount  = 0

$null = $batch.AppendLine("BEGIN TRANSACTION;")

Get-Content $TXT_FILE | ForEach-Object {
    $cols = $_ -split "`t"
    if ($cols.Count -ge 12) {
        $lat    = $cols[4]  # index 4 = column $5
        $lon    = $cols[5]  # index 5 = column $6
        $name   = $cols[1] -replace "'", "''"   # index 1 = column $2 (UTF-8 name)
        $admin1 = $cols[10] -replace "'", "''"
        $admin2 = $cols[11] -replace "'", "''"
        $cc     = $cols[8]  # index 8 = column $9

        $null = $batch.AppendLine("INSERT INTO cities (lat,lon,name,admin1,admin2,cc) VALUES ($lat,$lon,'$name','$admin1','$admin2','$cc');")
        $count++
        $totalCount++

        if ($count -ge $BATCH_SIZE) {
            $null = $batch.AppendLine("COMMIT;")
            & sqlite3 $OUTPUT_DB $batch.ToString()
            $batch.Clear()
            $null = $batch.AppendLine("BEGIN TRANSACTION;")
            $count = 0
            Write-Host "`r[+] Inserted $totalCount cities..." -NoNewline
        }
    }
}

# Flush remaining rows
if ($count -gt 0) {
    $null = $batch.AppendLine("COMMIT;")
    & sqlite3 $OUTPUT_DB $batch.ToString()
}

Write-Host ""
Write-Host "[+] Total cities inserted: $totalCount" -ForegroundColor Green

Write-Host "[+] Cleaning up GeoNames files..." -ForegroundColor Yellow
Remove-Item -Force $ZIP_FILE, $TXT_FILE -ErrorAction SilentlyContinue

# -----------------------------------------------------------------------------
# PART 3: INDEXES
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "[INDEXES] Creating indexes..." -ForegroundColor Yellow

# Detect SpatiaLite extension (tries common Windows paths)
$SPATIALITE_EXT = $null
$candidates = @(
    "mod_spatialite",
    "mod_spatialite.dll",
    (Join-Path $env:ProgramFiles "GDAL\mod_spatialite.dll"),
    (Join-Path $env:ProgramFiles "OSGeo4W\bin\mod_spatialite.dll"),
    (Join-Path $env:ProgramFiles "OSGeo4W64\bin\mod_spatialite.dll")
)

foreach ($ext in $candidates) {
    $test = & sqlite3 $OUTPUT_DB ".load $ext" 2>&1
    if ($LASTEXITCODE -eq 0) {
        $SPATIALITE_EXT = $ext
        break
    }
}

if (-not $SPATIALITE_EXT) {
    Write-Host "[!] Warning: mod_spatialite not found. Skipping spatial index." -ForegroundColor Yellow
    & sqlite3 $OUTPUT_DB @"
CREATE INDEX IF NOT EXISTS idx_lines_name  ON lines(name);
CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_cc   ON cities(cc);
VACUUM;
"@
} else {
    Write-Host "[+] SpatiaLite found: $SPATIALITE_EXT" -ForegroundColor Green
    & sqlite3 $OUTPUT_DB @"
.load $SPATIALITE_EXT
CREATE INDEX IF NOT EXISTS idx_lines_name  ON lines(name);
CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_cc   ON cities(cc);
SELECT CreateSpatialIndex('lines', 'GEOMETRY');
VACUUM;
"@
}

# -----------------------------------------------------------------------------
# DONE
# -----------------------------------------------------------------------------
$SIZE = (Get-Item $OUTPUT_DB).Length / 1MB
Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "[OK] Database ready: $OUTPUT_DB"        -ForegroundColor Green
Write-Host "     Location: $(Join-Path $WORK_DIR $OUTPUT_DB)"
Write-Host "     Tables:   lines, cities"
Write-Host ("     Size:     {0:N1} MB" -f $SIZE)
Write-Host "=======================================" -ForegroundColor Cyan