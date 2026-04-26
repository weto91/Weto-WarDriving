#!/bin/bash

# =============================================================================
# WETO Map Database Generator
# Generates a SpatiaLite DB with street lines + cities
# =============================================================================

BASE_URL="https://download.geofabrik.de"
GEONAMES_URL="https://download.geonames.org/export/dump/cities1000.zip"
OUTPUT_DB="localization.sqlite"

echo "======================================="
echo "      WETO Map Database Generator      "
echo "======================================="

# -----------------------------------------------------------------------------
# PART 1: STREETS (OpenStreetMap via Geofabrik)
# -----------------------------------------------------------------------------
echo ""
echo "[STREETS] Select continent (e.g., europe, north-america, south-america):"
read -p "> " CONTINENT

echo "[STREETS] Select country (e.g., spain, france, germany, usa):"
read -p "> " COUNTRY

URL="${BASE_URL}/${CONTINENT}/${COUNTRY}-latest.osm.pbf"
PBF_FILE="${COUNTRY}-latest.osm.pbf"

echo "[+] Downloading streets from: $URL"
wget -c --show-progress "$URL" -O "$PBF_FILE"

if [ $? -ne 0 ]; then
    echo "[!] Error: Could not download map file. Check names at download.geofabrik.de"
    exit 1
fi

echo "[+] Converting to SpatiaLite (table: lines)..."
ogr2ogr -f SQLite -dsco SPATIALITE=YES "$OUTPUT_DB" "$PBF_FILE" \
  -nln lines \
  -sql "SELECT name, highway FROM lines WHERE highway IS NOT NULL AND name IS NOT NULL" \
  -lco GEOMETRY_NAME=GEOMETRY \
  -overwrite

if [ $? -ne 0 ]; then
    echo "[!] Error during ogr2ogr conversion."
    rm -f "$PBF_FILE"
    exit 1
fi

echo "[+] Cleaning up PBF file..."
rm "$PBF_FILE"

# -----------------------------------------------------------------------------
# PART 2: CITIES (GeoNames cities1000)
# -----------------------------------------------------------------------------
echo ""
echo "[CITIES] Downloading GeoNames cities dataset..."
wget -q --show-progress "$GEONAMES_URL" -O cities1000.zip

if [ $? -ne 0 ]; then
    echo "[!] Error: Could not download GeoNames dataset."
    exit 1
fi

echo "[+] Extracting..."
unzip -o cities1000.zip cities1000.txt

echo "[+] Importing cities into database (table: cities)..."

# Parse TSV and insert into SQLite directly (no intermediate CSV)
# GeoNames columns used:
#   $2  = name (UTF-8)
#   $3  = asciiname
#   $5  = latitude
#   $6  = longitude
#   $9  = country code
#   $11 = admin1 code
#   $12 = admin2 code

sqlite3 "$OUTPUT_DB" "
CREATE TABLE IF NOT EXISTS cities (
    lat    REAL,
    lon    REAL,
    name   TEXT,
    admin1 TEXT,
    admin2 TEXT,
    cc     TEXT
);
"

awk -F'\t' 'BEGIN {OFS="\t"} {print $5, $6, $2, $11, $12, $9}' cities1000.txt | \
sqlite3 -separator $'\t' "$OUTPUT_DB" ".import /dev/stdin cities"

if [ $? -ne 0 ]; then
    echo "[!] Error importing cities data."
    rm -f cities1000.zip cities1000.txt
    exit 1
fi

echo "[+] Cleaning up GeoNames files..."
rm -f cities1000.zip cities1000.txt

# -----------------------------------------------------------------------------
# PART 3: INDEXES
# -----------------------------------------------------------------------------
echo ""
echo "[INDEXES] Creating indexes..."

# Detect SpatiaLite extension
SPATIALITE_EXT=""
for ext in mod_spatialite mod_spatialite.so spatialite; do
    if sqlite3 "$OUTPUT_DB" ".load $ext" 2>/dev/null; then
        SPATIALITE_EXT="$ext"
        break
    fi
done

if [ -z "$SPATIALITE_EXT" ]; then
    echo "[!] Warning: mod_spatialite not found. Skipping spatial index (name index only)."
    sqlite3 "$OUTPUT_DB" <<EOF
CREATE INDEX IF NOT EXISTS idx_lines_name   ON lines(name);
CREATE INDEX IF NOT EXISTS idx_cities_name  ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_cc    ON cities(cc);
VACUUM;
EOF
else
    sqlite3 "$OUTPUT_DB" <<EOF
.load $SPATIALITE_EXT
CREATE INDEX IF NOT EXISTS idx_lines_name   ON lines(name);
CREATE INDEX IF NOT EXISTS idx_cities_name  ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_cc    ON cities(cc);
SELECT CreateSpatialIndex('lines', 'GEOMETRY');
VACUUM;
EOF
fi

# -----------------------------------------------------------------------------
# DONE
# -----------------------------------------------------------------------------
echo ""
echo "======================================="
echo "[OK] Database ready: $OUTPUT_DB"
echo "     Location: $(pwd)/$OUTPUT_DB"
echo "     Tables:   lines, cities"
SIZE=$(du -sh "$OUTPUT_DB" | cut -f1)
echo "     Size:     $SIZE"
echo "======================================="
