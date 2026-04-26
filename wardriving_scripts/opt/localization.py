import mariadb
import sqlite3
import sys

# Configuración MariaDB
DB_CONFIG = {
    'host': 'localhost',
    'user': 'weto',
    'password': 'weto12345',
    'database': 'weto_db'
}

SQLITE_PATH = '/opt/localization.sqlite'

def get_geo_info(cursor_sq, lat, lon):
    """Consulta calle y ciudad en SQLite usando índices espaciales."""
    res = {'calle': 'unknown', 'ciudad': 'unknown'}

    # 1. Búsqueda de Ciudad (Bounding box de 0.1 grados)
    cursor_sq.execute("""
        SELECT name FROM cities
        WHERE lat BETWEEN ? - 0.1 AND ? + 0.1
          AND lon BETWEEN ? - 0.1 AND ? + 0.1
        ORDER BY ((lat - ?)*(lat - ?)) + ((lon - ?)*(lon - ?)) ASC
        LIMIT 1
    """, (lat, lat, lon, lon, lat, lat, lon, lon))
    city_row = cursor_sq.fetchone()
    if city_row:
        res['ciudad'] = city_row[0]

    # 2. Búsqueda de Calle (SpatiaLite SpatialIndex)
    try:
        dist = 0.002
        cursor_sq.execute("""
            SELECT name FROM lines
            WHERE ROWID IN (
                SELECT rowid FROM SpatialIndex
                WHERE f_table_name = 'lines'
                AND f_geometry_column = 'geometry'
                AND search_frame = BuildMBR(?, ?, ?, ?)
            )
            AND name IS NOT NULL
            ORDER BY Distance(geometry, MakePoint(?, ?, 4326)) ASC
            LIMIT 1
        """, (lon - dist, lat - dist, lon + dist, lat + dist, lon, lat))

        street_row = cursor_sq.fetchone()
        if street_row:
            res['calle'] = street_row[0]
    except sqlite3.OperationalError as e:
        print(f"[!] SpatiaLite error buscando calle para ({lat}, {lon}): {e}")

    return res

def main():
    try:
        conn_ma = mariadb.connect(**DB_CONFIG)
        cur_ma = conn_ma.cursor()

        conn_sq = sqlite3.connect(SQLITE_PATH)
        try:
            conn_sq.enable_load_extension(True)
            conn_sq.load_extension("mod_spatialite")
        except Exception as e:
            print(f"[!] Error cargando mod_spatialite: {e}")
            sys.exit(1)
        cur_sq = conn_sq.cursor()

        # Filtro extendido: procesa unknown, NULL y vacíos
        query_select = """
            SELECT bssid, lat, lon 
            FROM wifi_networks 
            WHERE lat != 0 
              AND (ciudad = 'unknown' OR ciudad IS NULL OR ciudad = '')
        """
        cur_ma.execute(query_select)
        rows = cur_ma.fetchall()

        if not rows:
            print("[*] No hay registros pendientes de geolocalización.")
            return

        print(f"[*] Procesando {len(rows)} registros...")

        for bssid, lat, lon in rows:
            lat_f, lon_f = float(lat), float(lon)
            geo = get_geo_info(cur_sq, lat_f, lon_f)

            cur_ma.execute(
                "UPDATE wifi_networks SET calle = ?, ciudad = ? WHERE bssid = ?",
                (geo['calle'], geo['ciudad'], bssid)
            )

        conn_ma.commit()
        print("[+] Sincronización geográfica completada.")

    except Exception as e:
        print(f"[!] Error crítico: {e}")
    finally:
        if 'conn_ma' in locals(): conn_ma.close()
        if 'conn_sq' in locals(): conn_sq.close()

if __name__ == "__main__":
    main()
