/*
 * Copyright (c) 2026 Álvaro Rubio Adán
 * Licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
 * Usage and modification permitted with attribution to the author.
 */

// ── NAV ──────────────────────────────────────────────────────────────────────
function toggleMenu() {
    document.getElementById('nav-menu').classList.toggle('active');
    const ov = document.getElementById('menu-overlay');
    ov.style.display = document.getElementById('nav-menu').classList.contains('active') ? 'block' : 'none';
}

// ── CLOCK ────────────────────────────────────────────────────────────────────
function tickClock() {
    document.getElementById('clock-val').textContent = new Date().toLocaleTimeString('es-ES');
}
setInterval(tickClock, 1000); tickClock();

// ── HELPERS ──────────────────────────────────────────────────────────────────
function post(action, extra = {}) {
    const body = new FormData();
    body.append('action', action);
    Object.entries(extra).forEach(([k, v]) => body.append(k, v));
    return fetch('setup_api.php', { method: 'POST', body }).then(r => r.json());
}

function showMsg(elId, text, type = 'info') {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.className = 'action-msg ' + type;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── CONFIRM MODAL ─────────────────────────────────────────────────────────────
let _pendingAction = null;

function confirmAction(action) {
    const titles = { reboot: '↺  REBOOT SYSTEM', shutdown: '⏻  SHUTDOWN SYSTEM' };
    const bodies  = {
        reboot:   'The system will restart immediately. Connection will be lost for approximately ~60 seconds.',
        shutdown: 'The system will shut down completely. Please disconnect all power sources in ~30 seconds.',
    };
    _pendingAction = action;
    document.getElementById('confirm-title').textContent = titles[action] || 'Confirm?';
    document.getElementById('confirm-body').textContent  = bodies[action] || '';
    document.getElementById('confirm-modal').style.display = 'flex';
}

function confirmRestart(svc) {
    _pendingAction = '__svc__' + svc;
    document.getElementById('confirm-title').textContent = '↺  RESTART SERVICE';
    document.getElementById('confirm-body').textContent  = 'Restart ' + svc + '? The service will be interrupted for a few seconds.';
    document.getElementById('confirm-modal').style.display = 'flex';
}

function closeConfirm() {
    _pendingAction = null;
    document.getElementById('confirm-modal').style.display = 'none';
}

function executeConfirmed() {
    if (!_pendingAction) return;

    if (_pendingAction.startsWith('__svc__')) {
        // ── Reinicio de servicio ──────────────────────────────────────────────
        const svc = _pendingAction.replace('__svc__', '');
        closeConfirm();
        post('restart_svc', { service: svc })
            .then(r => {
                showToast(r.ok ? r.message : r.error, r.ok ? 'ok' : 'error');
                fetchStatus();
            })
            .catch(() => showToast('Communication error.', 'error'));
    } else {
        // ── Reboot / shutdown ─────────────────────────────────────────────────
        const action = _pendingAction;
        closeConfirm();
        showMsg('power-msg', action === 'reboot' ? 'Rebooting...' : 'Powering off...', 'info');
        post(action)
            .then(r => showMsg('power-msg', r.message || (r.ok ? 'OK' : r.error), r.ok ? 'ok' : 'error'))
            .catch(() => showMsg('power-msg', 'Communication error.', 'error'));
    }
}

// ── TABS NETWORK MODE ─────────────────────────────────────────────────────────
let _activeTab = null;

function switchTab(tab) {
    ['ap', 'sta'].forEach(t => {
        document.getElementById('panel-' + t).style.display = 'none';
        document.getElementById('tab-' + t).classList.remove('active');
    });
    document.getElementById('panel-' + tab).style.display = 'block';
    document.getElementById('tab-' + tab).classList.add('active');
    _activeTab = tab;
}

// ── ACCESS POINT ──────────────────────────────────────────────────────────────
function applyAP() {
    const ssid = document.getElementById('ap-ssid').value.trim() || 'WetoWarDriving_AP';
    const pass = document.getElementById('ap-pass').value;
    const ch   = document.getElementById('ap-channel').value;
    if (pass.length < 8) { showMsg('ap-msg', 'The password must have at least 8 characters.', 'error'); return; }
    showMsg('ap-msg', 'Configuring the Access Point...', 'info');
    post('set_ap', { ssid, password: pass, channel: ch })
        .then(r => showMsg('ap-msg', r.ok ? r.message : r.error, r.ok ? 'ok' : 'error'))
        .catch(() => showMsg('ap-msg', 'Communication error.', 'error'));
}

// ── WIFI SCAN ─────────────────────────────────────────────────────────────────
let _selectedSSID = '';

function scanWifi() {
    const btn = document.getElementById('btn-scan');
    btn.disabled = true;
    btn.textContent = '⏳  Scanning...';
    document.getElementById('wifi-list').innerHTML = '<div style="opacity:0.4;font-size:11px;">Searching networks...</div>';
    document.getElementById('wifi-connect-form').style.display = 'none';

    post('scan_wifi')
        .then(r => {
            btn.disabled = false;
            btn.innerHTML = '🔍 &nbsp;SCAN NETWORKS';
            if (!r.ok) { showMsg('sta-msg', r.error || 'Scan error.', 'error'); return; }
            if (r.ap_mode) {
                renderApModeHint(r.hint_ssid, r.hint_pass);
            } else {
                renderWifiList(r.networks || []);
            }
        })
        .catch(() => {
            btn.disabled = false;
            btn.innerHTML = '🔍 &nbsp;SCAN NETWORKS';
            showMsg('sta-msg', 'Communication error.', 'error');
        });
}

function renderApModeHint(ssid, pass) {
    document.getElementById('wifi-list').innerHTML = `
        <div class="ap-hint-box">
            <div class="ap-hint-title">⚠ Wi-Fi chip scanning is disabled while in Access Point mode.</div>
            <div class="ap-hint-body">To connect the raspberry PI to a Wi-Fi network:</div>
            <div class="ap-hint-body" style="margin-top:10px;">
                <b style="color:#fff;">1.</b> Configure your smartphone's AP mode with the following details:
            </div>
            <div class="ap-cred-row">
                <div class="ap-cred-item">
                    <div class="ap-cred-lbl">SSID</div>
                    <div class="ap-cred-val">${esc(ssid)}</div>
                </div>
                <div class="ap-cred-item">
                    <div class="ap-cred-lbl">PASSWORD</div>
                    <div class="ap-cred-val">${esc(pass)}</div>
                </div>
            </div>
            <div class="ap-hint-body" style="margin-top:14px;">
                <b style="color:#fff;">2.</b> From your mobile device, open this same page in the browser.
            </div>
            <div class="ap-hint-body" style="margin-top:8px;">
                <b style="color:#fff;">3.</b> Click the button below to connect the Raspberry Pi to your smartphone (AP).
            </div>
            <button class="btn-action btn-primary" style="margin-top:16px;"
                onclick="connectToHintAP('${esc(ssid)}', '${esc(pass)}')">
                ▶ &nbsp;CONNECT RASPBERRY PI TO ${esc(ssid)}
            </button>
            <div id="hint-connect-msg" class="action-msg" style="display:none;"></div>
        </div>`;
}

function connectToHintAP(ssid, pass) {
    const msgEl = document.getElementById('hint-connect-msg');
    if (msgEl) {
        msgEl.textContent = 'Conecting to ' + ssid + '... (can take ~15s)';
        msgEl.className = 'action-msg info';
        msgEl.style.display = 'block';
    }
    post('connect_wifi', { ssid, password: pass })
        .then(r => {
            if (msgEl) {
                msgEl.textContent = r.ok ? r.message : r.error;
                msgEl.className = 'action-msg ' + (r.ok ? 'ok' : 'error');
            }
        })
        .catch(() => {
            if (msgEl) {
                msgEl.textContent = 'Communication error.';
                msgEl.className = 'action-msg error';
            }
        });
}

function renderWifiList(nets) {
    const el = document.getElementById('wifi-list');
    if (!nets.length) { el.innerHTML = '<div style="opacity:0.4;font-size:11px;">No available networks were found.</div>'; return; }
    el.innerHTML = nets.map(n => {
        const bars   = signalBars(n.quality);
        const secCol = secColor(n.security);
        return `<div class="wifi-item" onclick="selectWifi(this, '${esc(n.ssid)}')">
            <div class="wifi-ssid">${esc(n.ssid)}</div>
            <div class="wifi-meta">
                <span style="font-size:9px;opacity:0.5;">CH${n.channel}</span>
                <span class="wifi-sec" style="color:${secCol};border-color:${secCol};">${n.security}</span>
                <div class="wifi-bars">${bars}</div>
            </div>
        </div>`;
    }).join('');
}

function signalBars(quality) {
    return [25, 50, 75, 100].map((t, i) => {
        const h = (i + 1) * 3 + 2;
        return `<span style="height:${h}px;opacity:${quality >= t ? '1' : '0.2'};"></span>`;
    }).join('');
}

function secColor(sec) {
    const map = { 'OPEN':'#3498db', 'WEP':'#2ecc71', 'WPA':'#f39c12', 'WPA2':'#e67e22', 'WPA3':'#e74c3c' };
    return map[sec] || '#7f8c8d';
}

function selectWifi(el, ssid) {
    document.querySelectorAll('.wifi-item').forEach(i => i.classList.remove('selected'));
    el.classList.add('selected');
    _selectedSSID = ssid;
    document.getElementById('selected-ssid-label').textContent = '▶ ' + ssid;
    document.getElementById('sta-pass').value = '';
    document.getElementById('wifi-connect-form').style.display = 'block';
    document.getElementById('sta-pass').focus();
}

function cancelConnect() {
    _selectedSSID = '';
    document.getElementById('wifi-connect-form').style.display = 'none';
    document.querySelectorAll('.wifi-item').forEach(i => i.classList.remove('selected'));
}

function connectWifi() {
    if (!_selectedSSID) return;
    const pass = document.getElementById('sta-pass').value;
    if (pass.length < 8) { showMsg('sta-msg', 'The password must have at least 8 characters.', 'error'); return; }
    showMsg('sta-msg', 'Conecting to ' + _selectedSSID + '... (can take ~15s)', 'info');
    post('connect_wifi', { ssid: _selectedSSID, password: pass })
        .then(r => {
            showMsg('sta-msg', r.ok ? r.message : r.error, r.ok ? 'ok' : 'error');
            if (r.ok) cancelConnect();
        })
        .catch(() => showMsg('sta-msg', 'Communication error.', 'error'));
}

// ── JOURNAL ───────────────────────────────────────────────────────────────────
function showJournal(svc) {
    document.getElementById('journal-svc-label').textContent = svc;
    document.getElementById('journal-box').textContent = 'Loading...';
    post('journal', { service: svc, lines: 60 })
        .then(r => {
            if (!r.ok) { document.getElementById('journal-box').textContent = r.error; return; }
            renderJournal(r.log || '');
        })
        .catch(() => { document.getElementById('journal-box').textContent = 'Communication error.'; });
}

function renderJournal(raw) {
    const box = document.getElementById('journal-box');
    box.innerHTML = '';
    raw.split('\n').forEach(line => {
        const div = document.createElement('div');
        const low = line.toLowerCase();
        if (low.includes('error') || low.includes('failed') || low.includes('fatal')) div.className = 'journal-line err';
        else if (low.includes('warn'))                                                div.className = 'journal-line warn';
        else if (low.includes('start') || low.includes('active'))                    div.className = 'journal-line ok';
        else                                                                          div.className = 'journal-line info';
        div.textContent = line;
        box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    let t = document.getElementById('_toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '_toast';
        t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:30000;' +
                          'padding:10px 20px;font-family:Consolas,monospace;font-size:12px;letter-spacing:1px;' +
                          'pointer-events:none;transition:opacity .4s;';
        document.body.appendChild(t);
    }
    const colors = { ok: '#2ecc71', error: '#e74c3c', info: '#00f2ff' };
    const col = colors[type] || '#00f2ff';
    t.style.background = col + '22';
    t.style.border = '1px solid ' + col;
    t.style.color  = col;
    t.textContent  = msg;
    t.style.opacity = '1';
    clearTimeout(t._to);
    t._to = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}

// ── STATUS FETCH ──────────────────────────────────────────────────────────────
function fetchStatus() {
    post('status')
        .then(r => {
            if (!r.ok) return;
            renderHW(r);
            renderWlan0(r.wlan0 || {});
            renderServices(r.services || []);
            document.getElementById('sync-indicator').style.background = 'var(--green)';
        })
        .catch(() => {
            document.getElementById('sync-indicator').style.background = 'var(--red)';
        });
}

function renderHW(r) {
    const temp = (r.temp !== null && r.temp !== undefined) ? parseFloat(r.temp) : null;
    const tv = document.getElementById('temp-val');
    if (temp !== null) {
        tv.textContent = temp + '°C';
        tv.className = 'big-number ' + (temp < 60 ? 'ok' : temp < 75 ? 'warn' : 'crit');
        const bar = document.getElementById('temp-bar');
        bar.style.width = Math.min(Math.round((temp / 85) * 100), 100) + '%';
        bar.style.background = temp < 60 ? 'var(--green)' : temp < 75 ? 'var(--yellow)' : 'var(--red)';
    } else {
        tv.textContent = 'ERR';
        tv.className = 'big-number crit';
    }

    const flags = (r.throttle && r.throttle.length) ? r.throttle : ['OK'];
    const tv2 = document.getElementById('throttle-val');
    tv2.textContent = flags.join(' | ');
    tv2.style.color = flags[0] === 'OK' ? 'var(--green)' : 'var(--red)';

    const vv = document.getElementById('voltage-val');
    if (r.voltage !== null && r.voltage !== undefined && r.voltage !== '') {
        vv.textContent = r.voltage + ' V';
        vv.style.color = parseFloat(r.voltage) >= 1.2 ? 'var(--green)' : 'var(--red)';
    } else {
        vv.textContent = 'N/D';
        vv.style.color = '#5a6476';
        vv.title = 'Require vcgencmd in sudoers';
    }

    const fv = document.getElementById('freq-val');
    if (r.freq_mhz !== null && r.freq_mhz !== undefined) {
        fv.textContent = r.freq_mhz + ' MHz';
        fv.style.color = '#fff';
    } else {
        fv.textContent = 'N/D';
        fv.style.color = '#5a6476';
    }

    document.getElementById('disk-val').textContent = r.disk || '--';
}

function renderWlan0(w) {
    const badge = document.getElementById('wlan0-status-badge');
    const mode  = (w.mode || 'down').toLowerCase();
    badge.textContent = mode.toUpperCase();
    badge.className = 'mode-badge ' + (mode === 'ap' ? 'ap' : mode === 'managed' ? 'sta' : 'down');
    let info = w.ip || '';
    if (w.ssid) info += (info ? ' — ' : '') + w.ssid;
    document.getElementById('wlan0-ip').textContent = info || '--';
    if (_activeTab === null) {
        switchTab(mode === 'ap' ? 'ap' : 'sta');
        if (mode === 'ap' && w.ssid) document.getElementById('ap-ssid').value = w.ssid;
    }
}

function renderServices(svcs) {
    const el = document.getElementById('services-list');
    if (!svcs.length) { el.innerHTML = '<div style="opacity:0.4;font-size:11px;">Sin servicios.</div>'; return; }
    const stateLabel = { active:'RUNNING', inactive:'STOPPED', failed:'FAILED', 'not-found':'NOT FOUND' };
    el.innerHTML = svcs.map(s => {
        const errHtml = s.last_err
            ? `<div class="svc-sub">↳ ${esc(s.last_err.split('\n').filter(Boolean).pop() || '')}</div>`
            : '';
        const btns = s.state !== 'not-found'
            ? `<button class="svc-btn" onclick="confirmRestart('${s.name}')">↺ RESTART</button>
               <button class="svc-btn log" onclick="showJournal('${s.name}')">📋 LOG</button>`
            : `<span></span><span></span>`;
        return `<div class="svc-item ${s.state}">
            <div class="svc-info">
                <div class="svc-name">${s.name}</div>
                <div class="svc-desc">${esc(s.desc)}</div>
                ${errHtml}
            </div>
            <span class="svc-badge ${s.state}">${stateLabel[s.state] || s.state.toUpperCase()}</span>
            ${btns}
        </div>`;
    }).join('');
}

// ── BOOT ─────────────────────────────────────────────────────────────────────
fetchStatus();
setInterval(fetchStatus, 5000);
