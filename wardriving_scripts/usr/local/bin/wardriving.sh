#!/bin/bash

# --- CONFIGURACIÓN ---
IFACE="wlan1"
DB_USER="alra"; DB_PASS="Gmv2MGB2026*!"; DB_NAME="weto_db"

# 1. Configuración de Interfaz
ip link set $IFACE down
iw dev $IFACE set type monitor
ip link set $IFACE up

# Hopper en segundo plano
( while true; do for ch in {1..13}; do iw dev $IFACE set channel $ch 2>/dev/null; sleep 0.5; done; done ) &
HOPPER_PID=$!

# GPS en segundo plano: escribe continuamente la última posición válida (mode > 1) en un fichero temporal
GPS_FILE=$(mktemp)
gpspipe -w | jq -r --unbuffered '
  select(.class=="TPV" and .mode > 1) |
  "\(.lat) \(.lon) \(.time)"
' > "$GPS_FILE" &
GPS_PID=$!

# Trap unificado: limpia hopper, GPS y fichero temporal al salir
trap "kill $HOPPER_PID $GPS_PID 2>/dev/null; rm -f $GPS_FILE; exit" SIGINT SIGTERM

echo "[*] Motor WETO v1.1: Captura estricta (Solo redes con fix GPS)..."

# 2. Captura con TShark
tshark -i $IFACE -n -l -Q -Y "wlan.fc.type_subtype == 0x08" \
  -T fields -E separator='|' \
  -e wlan.sa -e wlan.ssid -e wlan_radio.signal_dbm -e wlan_radio.channel -e wlan.rsn.akms -e wlan.rsn.pcs.list -e wlan.fixed.capabilities.privacy | \
while IFS='|' read -r mac ssid_hex rssi chan akm_dec pcs_dec priv; do

    [[ -z "$mac" ]] && continue

    # A) GPS: FILTRO ESTRICTO
    # Lee la última coordenada válida escrita por el proceso GPS en background (lectura instantánea)
    # Si el fichero está vacío (sin fix aún), descarta el beacon igual que antes
    gps_data=$(tail -n 1 "$GPS_FILE" 2>/dev/null)
    if [[ -z "$gps_data" ]]; then
        continue
    fi
    read -r lat lon gps_time <<< "$gps_data"
    db_time=$(date -d "$gps_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date "+%Y-%m-%d %H:%M:%S")

    # B) Decodificar SSID
    if [[ "$ssid_hex" == "<MISSING>" || -z "$ssid_hex" ]]; then
        ssid_raw="[HIDDEN]"
    elif [[ "$ssid_hex" =~ ^[0-9a-fA-F]+$ ]]; then
        ssid_raw=$(echo "$ssid_hex" | xxd -r -p 2>/dev/null)
    else
        ssid_raw="$ssid_hex"
    fi
    ssid="${ssid_raw//\'/\'\'}"

    # C) Mapeo de Seguridad
    sec="UNKNOWN"
    [[ "$akm_dec" =~ "1027074" || "$akm_dec" =~ "1027078" ]] && sec="WPA2"
    [[ "$akm_dec" =~ "1027073" || "$akm_dec" =~ "1027077" ]] && sec="WPA2-ENT"
    [[ "$akm_dec" =~ "1027080" ]] && sec="WPA3"
    [[ -z "$akm_dec" ]] && { [[ "$priv" == "1" ]] && sec="WEP" || sec="OPEN"; }

    # D) Mapeo de Cifrado
    crypto="NONE"
    [[ "$pcs_dec" =~ "1027076" ]] && crypto="AES"
    [[ "$pcs_dec" =~ "1027081" ]] && crypto="AES-256"
    if [[ "$pcs_dec" =~ "1027074" ]]; then
        [[ "$crypto" != "NONE" ]] && crypto="$crypto/TKIP" || crypto="TKIP"
    fi
    [[ "$sec" == "WEP" ]] && crypto="WEP"
    [[ "$crypto" == "NONE" && "$sec" =~ "WPA" ]] && crypto="AES"

    # E) Resolución de Vendor
    prefix=$(echo "${mac//:/}" | cut -c1-6)
    v_vendor=$(mariadb -u$DB_USER -p$DB_PASS $DB_NAME -N -s -e "SELECT vendor FROM mac_cache WHERE prefix = '${prefix^^}' LIMIT 1;")
    [[ -z "$v_vendor" ]] && v_vendor="unknown"

    # F) SQL: Solo actualización por RSSI (Ya sabemos que lat/lon no son 0)
    query="INSERT INTO wifi_networks (bssid, ssid, rssi, security, crypto, channel, last_seen, lat, lon, vendor)
           VALUES ('${mac^^}', '$ssid', $rssi, '$sec', '$crypto', '$chan', '$db_time', $lat, $lon, '$v_vendor')
           ON DUPLICATE KEY UPDATE
           lat = IF(VALUES(rssi) > rssi, VALUES(lat), lat),
           lon = IF(VALUES(rssi) > rssi, VALUES(lon), lon),
           rssi = IF(VALUES(rssi) > rssi, VALUES(rssi), rssi),
           security = VALUES(security),
           crypto = VALUES(crypto),
           channel = VALUES(channel),
           vendor = IF(vendor = 'unknown', VALUES(vendor), vendor),
           last_seen = VALUES(last_seen);"

    mariadb -u$DB_USER -p$DB_PASS $DB_NAME -e "$query" 2>/dev/null

    printf "[+] %-17s | %-6s | %-8s | CH:%-2s | %s\n" "${mac^^}" "$sec" "$crypto" "$chan" "$ssid_raw"
done