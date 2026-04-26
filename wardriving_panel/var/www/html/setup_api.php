<?php
/**
 * Copyright (c) 2026 Álvaro Rubio Adán
 * Licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0)
 * You are free to share and adapt this material under the condition that
 * appropriate credit is given to the original author.
 * Full license text: https://creativecommons.org/licenses/by/4.0/
 *
 * setup_api.php — Backend for the setup panel
 *
 * PREREQUISITE — /etc/sudoers.d/weto-setup (W/O PASSWD for  www-data):
 *   www-data ALL=(ALL) NOPASSWD: /usr/bin/nmcli, /usr/bin/vcgencmd, /usr/sbin/iw, /usr/bin/iw, /sbin/ip, /sbin/reboot, /sbin/poweroff, /bin/systemctl restart *
 *
 * Temperature : /sys/class/thermal/thermal_zone0/temp   (dont need vcgencmd)
 * Frecuency  : /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
 * Voltaje     : vcgencmd with sudo (optional; null if not available)
 * Throttle    : vcgencmd with sudo (optional; fallback a hwmon)
 * WiFi / AP   : NetworkManager via nmcli con sudo
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// ── Helpers ───────────────────────────────────────────────────────────────────
function sh($cmd)  { return trim(shell_exec($cmd . ' 2>/dev/null') ?: ''); }
function sh2($cmd) { return trim(shell_exec($cmd . ' 2>&1')        ?: ''); }

function ok($data = [])  { echo json_encode(array_merge(['ok' => true],  $data)); exit; }
function err($msg)       { echo json_encode(['ok' => false, 'error' => $msg]);    exit; }

// ── Whitelist servicios ───────────────────────────────────────────────────────
$ALLOWED_SERVICES = [
    'wardriving.service',
    'gpscheck.service',
    'gpsd.service',
    'gpsd.socket',
    'apache2.service',
    'mariadb.service',
    'NetworkManager.service',
];

$action = $_POST['action'] ?? $_GET['action'] ?? 'status';

// ═════════════════════════════════════════════════════════════════════════════
// STATUS
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'status') {

    // ── Temperatura: /sys (siempre accesible por www-data) ────────────────────
    $temp = null;
    $raw = @file_get_contents('/sys/class/thermal/thermal_zone0/temp');
    if ($raw !== false) $temp = round(intval(trim($raw)) / 1000, 1);

    // ── Frecuencia ARM: /sys/cpufreq (siempre accesible) ─────────────────────
    $freq_mhz = null;
    $raw_freq = @file_get_contents('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
    if ($raw_freq !== false) {
        $freq_mhz = round(intval(trim($raw_freq)) / 1000); // kHz → MHz
    }

    // ── Voltaje core: vcgencmd con sudo (null si no disponible) ──────────────
    $voltage = null;
    $vcg_v = sh('sudo /usr/bin/vcgencmd measure_volts core');
    if (preg_match('/volt=([0-9.]+)V/', $vcg_v, $m)) $voltage = $m[1];

    // ── Throttle: vcgencmd con sudo; fallback hwmon ───────────────────────────
    $throttle_flags = [];
    $throttle_hex   = '0x0';
    $vcg_t = sh('sudo /usr/bin/vcgencmd get_throttled');
    if (preg_match('/throttled=(0x[0-9a-fA-F]+)/i', $vcg_t, $mt)) {
        $throttle_hex = $mt[1];
        $ti = hexdec($throttle_hex);
        if ($ti & 0x1)     $throttle_flags[] = 'UNDERVOLTAGE';
        if ($ti & 0x2)     $throttle_flags[] = 'FREQ_CAPPED';
        if ($ti & 0x4)     $throttle_flags[] = 'THROTTLED';
        if ($ti & 0x8)     $throttle_flags[] = 'SOFT_TEMP_LIMIT';
        if ($ti & 0x10000) $throttle_flags[] = 'PREV_UNDERVOLTAGE';
        if (empty($throttle_flags)) $throttle_flags[] = 'OK';
    } else {
        // Fallback hwmon: under-voltage bit
        $uv_files = glob('/sys/devices/platform/soc/soc:firmware/raspberrypi-hwmon/hwmon/hwmon*/in0_lcrit_alarm');
        $uv = $uv_files ? intval(@file_get_contents($uv_files[0])) : 0;
        $throttle_flags[] = $uv ? 'UNDERVOLTAGE' : 'OK';
        if (!$vcg_t) $throttle_hex = 'N/D';
    }

    // ── Disco libre ───────────────────────────────────────────────────────────
    $disk = sh("df -h / | tail -1 | awk '{print $4\" libre / \"$2\" total\"}'");

    // ── wlan0 via nmcli ───────────────────────────────────────────────────────
    // Obtener conexión activa en wlan0
    $active_con = sh("nmcli -t -f NAME,DEVICE con show --active | grep ':wlan0' | cut -d: -f1 | head -1");
    $wlan0_ip   = sh("ip -4 addr show wlan0 | grep -oP '(?<=inet )[^/]+'");

    $mode = 'down';
    $ssid = '';

    if ($active_con) {
        // Determinar si es AP o STA mirando el modo 802-11
        $con_mode = sh("nmcli -t -f 802-11-wireless.mode con show " . escapeshellarg($active_con) . " | cut -d: -f2");
        if (strtolower(trim($con_mode)) === 'ap') {
            $mode = 'ap';
            $ssid = sh("nmcli -t -f 802-11-wireless.ssid con show " . escapeshellarg($active_con) . " | cut -d: -f2");
            if (!$ssid) $ssid = $active_con;
        } else {
            $mode = 'managed';
            $ssid = $active_con; // NM usa el SSID como nombre de conexión
        }
    }

    $wlan0 = [
        'mode'  => $mode,
        'ip'    => $wlan0_ip,
        'ssid'  => $ssid,
        'con'   => $active_con,
    ];

    // ── Servicios ─────────────────────────────────────────────────────────────
    global $ALLOWED_SERVICES;
    $services = [];
    foreach ($ALLOWED_SERVICES as $svc) {
        $raw = sh2("systemctl show " . escapeshellarg($svc) .
                   " --no-pager --property=ActiveState,SubState,LoadState,Description,Result");
        $props = [];
        foreach (explode("\n", $raw) as $line) {
            if (strpos($line, '=') !== false) {
                [$k, $v] = explode('=', $line, 2);
                $props[trim($k)] = trim($v);
            }
        }
        $active = $props['ActiveState'] ?? 'unknown';
        $sub    = $props['SubState']    ?? 'unknown';
        $load   = $props['LoadState']   ?? 'unknown';
        $desc   = $props['Description'] ?? $svc;
        $result = $props['Result']      ?? 'success';

        if ($load === 'not-found') {
            $state = 'not-found';
        } elseif ($active === 'active' && in_array($sub, ['running','listening','exited'])) {
            $state = 'active';
        } elseif ($active === 'failed' || $result === 'exit-code') {
            $state = 'failed';
        } else {
            $state = 'inactive';
        }

        $last_err = '';
        if ($state !== 'active' && $state !== 'not-found') {
            $last_err = sh("journalctl -u " . escapeshellarg($svc) . " -n 4 --no-pager -o cat");
        }

        $services[] = [
            'name'     => $svc,
            'desc'     => $desc,
            'state'    => $state,
            'active'   => $active,
            'sub'      => $sub,
            'result'   => $result,
            'last_err' => $last_err,
        ];
    }

    ok([
        'temp'         => $temp,
        'throttle'     => $throttle_flags,
        'throttle_hex' => $throttle_hex,
        'voltage'      => $voltage,
        'freq_mhz'     => $freq_mhz,
        'disk'         => $disk,
        'wlan0'        => $wlan0,
        'services'     => $services,
    ]);
}

// ═════════════════════════════════════════════════════════════════════════════
// SCAN WIFI
// - Modo managed: scan normal con nmcli
// - Modo AP: el chip no puede escanear mientras emite. Se devuelve la red
//   predefinida WETO-W-WIFI para que el usuario cambie de modo desde el móvil
//   conectado al AP, y luego conecte la RPi a esa WiFi.
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'scan_wifi') {

    $wlan0_type = strtolower(sh("iw dev wlan0 info 2>/dev/null | grep -w type | awk '{print $2}'"));

    if ($wlan0_type === 'ap') {
        // En modo AP no se puede escanear; devolver red predefinida + aviso
        ok([
            'networks'  => [],
            'ap_mode'   => true,
            'hint_ssid' => 'WETO-W-WIFI',
            'hint_pass' => 'wetowardriving12345678',
        ]);
    }

    // ── Modo managed: scan normal ─────────────────────────────────────────────
    sh('sudo nmcli dev wifi rescan ifname wlan0 2>/dev/null');
    sleep(2);
    $raw = sh('nmcli -t -f SSID,BSSID,SIGNAL,SECURITY,CHAN dev wifi list ifname wlan0');
    $networks = parseNmcliWifi($raw);
    usort($networks, fn($a, $b) => $b['quality'] - $a['quality']);
    ok(['networks' => $networks, 'ap_mode' => false]);
}

function parseNmcliWifi($raw) {
    $networks = [];
    $seen = [];
    foreach (explode("\n", $raw) as $line) {
        $line = trim($line);
        if (!$line) continue;
        $parts = preg_split('/(?<!\\\\):/', $line, 5);
        if (count($parts) < 5) continue;
        $parts = array_map(fn($p) => str_replace('\\:', ':', $p), $parts);
        $ssid = trim($parts[0]);
        if ($ssid === '' || isset($seen[$ssid])) continue;
        $seen[$ssid] = true;
        $networks[] = [
            'ssid'     => $ssid,
            'bssid'    => trim($parts[1]),
            'quality'  => intval($parts[2]),
            'security' => trim($parts[3]) ?: 'OPEN',
            'channel'  => intval($parts[4]),
        ];
    }
    return $networks;
}


// ═════════════════════════════════════════════════════════════════════════════
// CONNECT WIFI — nmcli
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'connect_wifi') {
    $ssid = $_POST['ssid']     ?? '';
    $pass = $_POST['password'] ?? '';

    if (!$ssid)            err('SSID requerido.');
    if (strlen($pass) < 8) err('La contraseña debe tener al menos 8 caracteres.');

    // Bajar conexión activa en wlan0 si existe (incluyendo AP)
    $active_con = sh("nmcli -t -f NAME,DEVICE con show --active | grep ':wlan0' | cut -d: -f1 | head -1");
    if ($active_con) sh("sudo nmcli con down " . escapeshellarg($active_con));

    // Eliminar perfil previo con ese SSID para evitar conflictos
    sh("sudo nmcli con delete " . escapeshellarg($ssid) . " 2>/dev/null");

    // Conectar: nmcli crea perfil y conecta en un paso
    $out = sh2("sudo nmcli dev wifi connect " . escapeshellarg($ssid) .
               " password " . escapeshellarg($pass) . " ifname wlan0");

    if (stripos($out, 'successfully') !== false || stripos($out, 'activat') !== false) {
        sleep(2);
        $ip = sh("ip -4 addr show wlan0 | grep -oP '(?<=inet )[^/]+'");
        ok(['message' => "Conectado a «$ssid»" . ($ip ? " — IP: $ip" : " (obteniendo IP...)"), 'ip' => $ip]);
    } else {
        err("Error al conectar: $out");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SET AP — nmcli hotspot
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'set_ap') {
    $ssid    = trim($_POST['ssid']     ?? 'WetoWarDriving_AP');
    $pass    = $_POST['password']      ?? '';
    $channel = intval($_POST['channel'] ?? 6);

    if (strlen($pass) < 8) err('La contraseña del AP debe tener al menos 8 caracteres.');
    $ssid_safe = preg_replace('/[^a-zA-Z0-9_\-. ]/', '', $ssid) ?: 'WetoAP';
    if ($channel < 1 || $channel > 13) $channel = 6;

    // Bajar conexión activa en wlan0
    $active_con = sh("nmcli -t -f NAME,DEVICE con show --active | grep ':wlan0' | cut -d: -f1 | head -1");
    if ($active_con) sh("sudo nmcli con down " . escapeshellarg($active_con));

    // Eliminar perfil AP previo
    sh("sudo nmcli con delete 'WetoAP-Hotspot' 2>/dev/null");

    // Crear perfil hotspot
    sh("sudo nmcli con add type wifi ifname wlan0 con-name 'WetoAP-Hotspot' autoconnect no ssid " . escapeshellarg($ssid_safe));
    sh("sudo nmcli con modify 'WetoAP-Hotspot' 802-11-wireless.mode ap 802-11-wireless.band bg " .
       "802-11-wireless.channel " . intval($channel));
    sh("sudo nmcli con modify 'WetoAP-Hotspot' wifi-sec.key-mgmt wpa-psk wifi-sec.psk " . escapeshellarg($pass));
    sh("sudo nmcli con modify 'WetoAP-Hotspot' ipv4.method shared ipv6.method disabled");
    sh("sudo nmcli con modify 'WetoAP-Hotspot' ipv4.addresses 10.0.0.1/24");
    $result = sh2("sudo nmcli con up 'WetoAP-Hotspot'");

    if (stripos($result, 'successfully') !== false || stripos($result, 'activat') !== false) {
        ok(['message' => "AP «$ssid_safe» activo en canal $channel — IP gateway: 10.0.0.1"]);
    } else {
        err("No se pudo activar el AP: $result");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// RESTART SERVICE
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'restart_svc') {
    global $ALLOWED_SERVICES;
    $svc = $_POST['service'] ?? '';
    if (!in_array($svc, $ALLOWED_SERVICES)) err('Servicio no permitido.');

    $svc_esc = escapeshellarg($svc);
    sh2("sudo systemctl restart $svc_esc");
    sleep(1);
    $active = sh("systemctl is-active $svc_esc");
    ok(['message' => "«$svc» reiniciado — estado: " . trim($active), 'active' => trim($active)]);
}

// ═════════════════════════════════════════════════════════════════════════════
// JOURNAL
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'journal') {
    global $ALLOWED_SERVICES;
    $svc   = $_POST['service'] ?? '';
    $lines = min(intval($_POST['lines'] ?? 60), 200);
    if (!in_array($svc, $ALLOWED_SERVICES)) err('Servicio no permitido.');

    $log = sh2("journalctl -u " . escapeshellarg($svc) . " -n $lines --no-pager --output=short-iso");
    ok(['log' => $log, 'service' => $svc]);
}

// ═════════════════════════════════════════════════════════════════════════════
// REBOOT / SHUTDOWN
// ═════════════════════════════════════════════════════════════════════════════
if ($action === 'reboot') {
    echo json_encode(['ok' => true, 'message' => 'Sistema reiniciando en 2 segundos...']);
    flush(); ob_flush();
    sleep(1);
    sh('sudo reboot');
    exit;
}

if ($action === 'shutdown') {
    echo json_encode(['ok' => true, 'message' => 'Sistema apagándose en 2 segundos...']);
    flush(); ob_flush();
    sleep(1);
    sh('sudo poweroff');
    exit;
}

err('Acción desconocida: ' . htmlspecialchars($action));
