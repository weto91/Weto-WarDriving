<?php
	/**
	* Copyright (c) 2026 Álvaro Rubio Adán
	* Licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0)
	* * You are free to share and adapt this material under the condition that 
	* appropriate credit is given to the original author.
	* * Full license text: https://creativecommons.org/licenses/by/4.0/
	*/

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$db_config = [
    'dsn'  => 'mysql:host=localhost;dbname=weto_db;charset=utf8mb4',
    'user' => 'weto',
    'pass' => 'weto12345'
];

$response = [];

// ── 1. SYSTEM: CPU & RAM ─────────────────────────────────────────────────────
// CPU: main load in the last minute
$load = sys_getloadavg();
$cpu_load = round($load[0] * 100 / (int)shell_exec('nproc'), 1);
$cpu_load = min($cpu_load, 100);

// RAM from /proc/meminfo
$meminfo = file_get_contents('/proc/meminfo');
preg_match('/MemTotal:\s+(\d+)/', $meminfo, $mt);
preg_match('/MemAvailable:\s+(\d+)/', $meminfo, $ma);
$mem_total = isset($mt[1]) ? (int)$mt[1] : 0;
$mem_avail = isset($ma[1]) ? (int)$ma[1] : 0;
$mem_used  = $mem_total - $mem_avail;
$mem_pct   = $mem_total > 0 ? round(($mem_used / $mem_total) * 100, 1) : 0;

$response['system'] = [
    'cpu_pct'       => $cpu_load,
    'mem_used_mb'   => round($mem_used / 1024, 0),
    'mem_total_mb'  => round($mem_total / 1024, 0),
    'mem_pct'       => $mem_pct,
    'uptime'        => trim(shell_exec("awk '{printf \"%d days %02d:%02d:%02d\", $1/86400, ($1%86400)/3600, ($1%3600)/60, $1%60}' /proc/uptime")),
];

// ── 2. GPS: status of /dev/ttyAMA0 via gpsd ─────────────────────────────────────
// Trying to read the mode of the last TPV from gpspipe(timeout 1s)
$gps_mode = 0;
$gps_lat  = null;
$gps_lon  = null;
$gps_time = null;
$gps_sats = null;

$gpspipe_output = shell_exec('timeout 1.5 gpspipe -w -n 10 2>/dev/null');
if ($gpspipe_output) {
    foreach (explode("\n", $gpspipe_output) as $line) {
        $obj = json_decode($line, true);
        if (!$obj) continue;
        if (($obj['class'] ?? '') === 'TPV') {
            $gps_mode = (int)($obj['mode'] ?? 0);
            $gps_lat  = $obj['lat'] ?? null;
            $gps_lon  = $obj['lon'] ?? null;
            $gps_time = $obj['time'] ?? null;
        }
        if (($obj['class'] ?? '') === 'SKY') {
            $used = 0;
            foreach (($obj['satellites'] ?? []) as $s) {
                if ($s['used'] ?? false) $used++;
            }
            $gps_sats = $used;
        }
    }
}

// If gpspipe fails, check if the port exists
$port_exists = file_exists('/dev/ttyAMA0');

$mode_labels = [0 => 'NO_FIX', 1 => 'NO_FIX', 2 => 'FIX_2D', 3 => 'FIX_3D'];
$response['gps'] = [
    'mode'        => $gps_mode,
    'mode_label'  => $mode_labels[$gps_mode] ?? 'UNKNOWN',
    'lat'         => $gps_lat,
    'lon'         => $gps_lon,
    'time'        => $gps_time,
    'satellites'  => $gps_sats,
    'port_active' => $port_exists,
];

// ── 3. DATABASE ──────────────────────────────────────────────────────────
try {
    $pdo = new PDO($db_config['dsn'], $db_config['user'], $db_config['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    // Total networks
    $total = (int)$pdo->query("SELECT COUNT(*) FROM wifi_networks")->fetchColumn();

    // last network updated / added
    $last = $pdo->query(
        "SELECT ssid, bssid, security, calle, ciudad, rssi, last_seen, vendor, lat, lon, channel, crypto
         FROM wifi_networks ORDER BY last_seen DESC LIMIT 1"
    )->fetch();

    // Security breakdown
    $sec_rows = $pdo->query(
        "SELECT security, COUNT(*) as cnt FROM wifi_networks GROUP BY security ORDER BY cnt DESC"
    )->fetchAll();
    $sec_dist = [];
    foreach ($sec_rows as $r) $sec_dist[$r['security'] ?: 'UNKNOWN'] = (int)$r['cnt'];

    // Top 3 cities
    $city_rows = $pdo->query(
        "SELECT ciudad, COUNT(*) as cnt FROM wifi_networks WHERE ciudad IS NOT NULL AND ciudad != '' AND ciudad != 'unknown'
         GROUP BY ciudad ORDER BY cnt DESC LIMIT 3"
    )->fetchAll();
    $top_cities = [];
    foreach ($city_rows as $r) $top_cities[] = ['city' => $r['ciudad'], 'count' => (int)$r['cnt']];

    // New networks in the last 24 hours
    $new_24h = (int)$pdo->query(
        "SELECT COUNT(*) FROM wifi_networks WHERE last_seen >= NOW() - INTERVAL 24 HOUR"
    )->fetchColumn();

    // Open networks (with risk)
    $open_count = (int)$pdo->query(
        "SELECT COUNT(*) FROM wifi_networks WHERE security = 'OPEN'"
    )->fetchColumn();

    // channle distribution (top 5)
    $ch_rows = $pdo->query(
        "SELECT channel, COUNT(*) as cnt FROM wifi_networks GROUP BY channel ORDER BY cnt DESC LIMIT 5"
    )->fetchAll();
    $ch_dist = [];
    foreach ($ch_rows as $r) $ch_dist[(string)$r['channel']] = (int)$r['cnt'];

    $response['db'] = [
        'total'      => $total,
        'last_net'   => $last ?: null,
        'sec_dist'   => $sec_dist,
        'top_cities' => $top_cities,
        'new_24h'    => $new_24h,
        'open_count' => $open_count,
        'ch_dist'    => $ch_dist,
    ];

} catch (PDOException $e) {
    $response['db'] = ['error' => $e->getMessage()];
}

// ── 4. WARDRIVING ACTIVE SERVICES ──────────────────────────────────────────────
$tshark_running = (int)trim(shell_exec('pgrep -c tshark 2>/dev/null') ?: '0') > 0;
$wdrv_running   = (int)trim(shell_exec('pgrep -fc wardriving 2>/dev/null') ?: '0') > 0;
$hopper_running = (int)trim(shell_exec('pgrep -c iw 2>/dev/null') ?: '0') > 0;

// Enabled monitor interface
$iface_mode = trim(shell_exec('iw dev wlan1 info 2>/dev/null | grep -i type | awk \'{print $2}\'') ?: 'N/A');

$response['wardriving'] = [
    'tshark_active'  => $tshark_running,
    'script_active'  => $wdrv_running,
    'hopper_active'  => $hopper_running,
    'iface_mode'     => strtoupper($iface_mode),
];

// ── 5. LAST DETECTED NETWORKS(live feed) ───────────────────────────────────
try {
    if (!isset($pdo)) {
        $pdo = new PDO($db_config['dsn'], $db_config['user'], $db_config['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    $live = $pdo->query(
        "SELECT ssid, bssid, security, rssi, channel, vendor, last_seen, ciudad
         FROM wifi_networks ORDER BY last_seen DESC LIMIT 20"
    )->fetchAll();
    $response['live_feed'] = $live;
} catch (PDOException $e) {
    $response['live_feed'] = [];
}

// ── 6. TIMESTAMP ─────────────────────────────────────────────────────────────
$response['timestamp'] = date('Y-m-d H:i:s');

echo json_encode($response);
