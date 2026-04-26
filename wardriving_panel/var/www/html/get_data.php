<?php
/**
 * Copyright (c) 2026 Álvaro Rubio Adán
 * Licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0)
 * * You are free to share and adapt this material under the condition that 
 * appropriate credit is given to the original author.
 * * Full license text: https://creativecommons.org/licenses/by/4.0/
 */

header('Content-Type: application/json');
$db_config = [
    'dsn'  => 'mysql:host=localhost;dbname=weto_db;charset=utf8mb4',
    'user' => 'weto',
    'pass' => 'weto12345'
];

try {
    $pdo = new PDO($db_config['dsn'], $db_config['user'], $db_config['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
    
    $draw   = $_GET['draw'] ?? 1;
    $start  = (int)($_GET['start'] ?? 0);
    $length = (int)($_GET['length'] ?? 10);
    $search = $_GET['search']['value'] ?? '';

    // CRITICAL MAPPING: Must match the column order in index.html.
    // 0:SSID, 1:SEC, 2:CITY, 3:STREET, 4:DATE
    $cols = ['ssid', 'security', 'ciudad', 'calle', 'last_seen'];
    
    $oIdx = $_GET['order'][0]['column'] ?? 4; // By default column 4 (Date)
    $oDir = $_GET['order'][0]['dir'] ?? 'desc';
    $oCol = $cols[$oIdx] ?? 'last_seen';

    $where = "";
    $params = [];
    if ($search) {
        $where = "WHERE ssid LIKE :s OR bssid LIKE :s OR vendor LIKE :s OR ciudad LIKE :s OR calle LIKE :s OR security LIKE :s";
    $params[':s'] = "%$search%";
    }

    // Totals for pagination
    $total = $pdo->query("SELECT COUNT(*) FROM wifi_networks")->fetchColumn();
    $stmtF = $pdo->prepare("SELECT COUNT(*) FROM wifi_networks $where");
    $stmtF->execute($params);
    $filtered = $stmtF->fetchColumn();

    // Query with Global Sorting before LIMIT
    $sql = "SELECT ssid as s, bssid as m, vendor as v, rssi as r, security as sec, crypto as c, 
                   channel as ch, last_seen as t, lat as la, lon as lo, calle, ciudad 
            FROM wifi_networks $where 
            ORDER BY $oCol $oDir 
            LIMIT $start, $length";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $data = $stmt->fetchAll();

    echo json_encode([
        "draw" => (int)$draw,
        "recordsTotal" => (int)$total,
        "recordsFiltered" => (int)$filtered,
        "data" => $data
    ]);

} catch (PDOException $e) {
    echo json_encode(["error" => $e->getMessage()]);
}