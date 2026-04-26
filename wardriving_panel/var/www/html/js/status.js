// ── MENÚ ─────────────────────────────────────────────────────────────
        function toggleMenu() {
            document.getElementById('nav-menu').classList.toggle('active');
            const ov = document.getElementById('menu-overlay');
            ov.style.display = document.getElementById('nav-menu').classList.contains('active') ? 'block' : 'none';
        }

        // ── RELOJ LOCAL ───────────────────────────────────────────────────────
        function tickClock() {
            document.getElementById('clock-val').textContent = new Date().toLocaleTimeString('es-ES');
        }
        setInterval(tickClock, 1000); tickClock();

        // ── COLORES UTILIDADES ────────────────────────────────────────────────
        const SEC_COLORS = {
            'OPEN':'#3498db','OWE':'#00d2ff','WEP':'#2ecc71','WPA':'#f39c12',
            'WPA2':'#e67e22','WPA/WPA2':'#d35400','WPA2-ENT':'#9b59b6',
            'WPA3':'#e74c3c','WPA2/WPA3':'#c0392b','WPA3-ENT192':'#8e44ad',
            'WAPI':'#1abc9c','UNKNOWN':'#7f8c8d'
        };
        function secColor(s) { return SEC_COLORS[(s||'UNKNOWN').toUpperCase()] || '#7f8c8d'; }
        function rssiColor(r) {
            r = parseInt(r);
            if (r > -60) return 'var(--green)';
            if (r > -80) return 'var(--yellow)';
            return 'var(--red)';
        }
        function pctClass(v) {
            if (v < 60) return 'ok';
            if (v < 85) return 'warn';
            return 'crit';
        }
        function barColor(v) {
            if (v < 60) return 'var(--green)';
            if (v < 85) return 'var(--yellow)';
            return 'var(--red)';
        }

        // ── ESTADO PREVIO FEED ────────────────────────────────────────────────
        let prevFeedBssids = [];

        // ── RENDER ────────────────────────────────────────────────────────────
        function render(data) {

            // ── SISTEMA ──────────────────────────────────────────────────────
            if (data.system) {
                const s = data.system;
                const cpuEl = document.getElementById('cpu-val');
                cpuEl.textContent = s.cpu_pct + '%';
                cpuEl.className = 'big-number ' + pctClass(s.cpu_pct);
                document.getElementById('cpu-bar').style.width = s.cpu_pct + '%';
                document.getElementById('cpu-bar').style.background = barColor(s.cpu_pct);
                document.getElementById('cpu-bar-lbl').textContent = s.cpu_pct + '%';

                const memEl = document.getElementById('mem-val');
                memEl.textContent = s.mem_pct + '%';
                memEl.className = 'big-number ' + pctClass(s.mem_pct);
                document.getElementById('mem-bar').style.width = s.mem_pct + '%';
                document.getElementById('mem-bar').style.background = barColor(s.mem_pct);
                document.getElementById('mem-used-lbl').textContent = s.mem_used_mb + ' MB usados';
                document.getElementById('mem-total-lbl').textContent = s.mem_total_mb + ' MB total';

                document.getElementById('uptime-val').textContent = s.uptime || '--';
            }

            // ── GPS ───────────────────────────────────────────────────────────
            if (data.gps) {
                const g = data.gps;
                const modeColors  = { 0:'#7f8c8d', 1:'#e74c3c', 2:'#f1c40f', 3:'#2ecc71' };
                const modeDescs   = { 0:'Sin señal GPS', 1:'Sin fix — buscando satélites', 2:'Fix 2D — solo lat/lon', 3:'Fix 3D — lat/lon + altitud' };
                const badge = document.getElementById('gps-badge');
                badge.textContent = 'MODE ' + g.mode + ' — ' + g.mode_label;
                badge.style.background = (modeColors[g.mode] || '#7f8c8d') + '22';
                badge.style.color      = modeColors[g.mode] || '#7f8c8d';
                badge.style.border     = '1px solid ' + (modeColors[g.mode] || '#7f8c8d');
                document.getElementById('gps-desc').textContent = modeDescs[g.mode] || '';
                document.getElementById('gps-lat').textContent  = 'LAT: ' + (g.lat  !== null ? g.lat.toFixed(6)  : '--');
                document.getElementById('gps-lon').textContent  = 'LON: ' + (g.lon  !== null ? g.lon.toFixed(6)  : '--');
                document.getElementById('gps-sats').textContent = g.satellites !== null ? g.satellites : '--';
                document.getElementById('gps-time').textContent = g.time ? g.time.replace('T',' ').substring(0,19) : '--';
                const portEl = document.getElementById('gps-port');
                portEl.textContent = g.port_active ? 'ACTIVO' : 'INACTIVO';
                portEl.style.color = g.port_active ? 'var(--green)' : 'var(--red)';
            }

            // ── DB TOTALES ────────────────────────────────────────────────────
            if (data.db && !data.db.error) {
                const db = data.db;
                document.getElementById('db-total').textContent = db.total.toLocaleString();
                document.getElementById('db-24h').textContent   = db.new_24h.toLocaleString();
                document.getElementById('db-open').textContent  = db.open_count.toLocaleString();

                // Alerta redes abiertas
                const ac = document.getElementById('alert-open-container');
                if (db.open_count > 0) {
                    const pct = ((db.open_count / db.total) * 100).toFixed(1);
                    ac.innerHTML = `<div class="alert-box warn">⚠️ ${pct}% de las redes son OPEN (sin cifrado)</div>`;
                } else {
                    ac.innerHTML = '';
                }

                // Top ciudades
                const cl = document.getElementById('cities-list');
                if (db.top_cities && db.top_cities.length) {
                    cl.innerHTML = db.top_cities.map(c =>
                        `<div class="city-item"><span>${c.city || 'UNKNOWN'}</span><span>${c.count}</span></div>`
                    ).join('');
                }

                // Canales
                const cg = document.getElementById('ch-grid');
                if (db.ch_dist) {
                    cg.innerHTML = Object.entries(db.ch_dist)
                        .sort((a,b) => b[1]-a[1])
                        .map(([ch, cnt]) =>
                            `<div class="ch-badge"><div class="ch-num">CH${ch}</div><div class="ch-cnt">${cnt}</div></div>`
                        ).join('');
                }

                // Seguridad distribución
                const sb = document.getElementById('sec-bars');
                if (db.sec_dist) {
                    const total = Object.values(db.sec_dist).reduce((a,b) => a+b, 0);
                    sb.innerHTML = Object.entries(db.sec_dist)
                        .sort((a,b) => b[1]-a[1])
                        .map(([sec, cnt]) => {
                            const pct = total > 0 ? (cnt/total*100).toFixed(1) : 0;
                            const col = secColor(sec);
                            return `<div class="sec-row">
                                <div class="sec-name">${sec}</div>
                                <div class="sec-bar-wrap"><div class="sec-bar-fill" style="width:${pct}%; background:${col};"></div></div>
                                <div class="sec-cnt">${cnt}</div>
                            </div>`;
                        }).join('');
                }

                // Última red
                const ln = document.getElementById('last-net');
                if (db.last_net) {
                    const n = db.last_net;
                    const sc = secColor(n.security);
                    ln.innerHTML = `
                        <div class="lnet-ssid">${n.ssid || '[HIDDEN]'}</div>
                        <div class="lnet-grid">
                            <div class="lnet-row"><div class="lk">BSSID</div><div class="lv" style="font-size:10px;">${n.bssid}</div></div>
                            <div class="lnet-row"><div class="lk">VENDOR</div><div class="lv">${n.vendor || '--'}</div></div>
                            <div class="lnet-row"><div class="lk">SEGURIDAD</div><div class="lv" style="color:${sc};">${n.security}</div></div>
                            <div class="lnet-row"><div class="lk">CIFRADO</div><div class="lv">${n.crypto || '--'}</div></div>
                            <div class="lnet-row"><div class="lk">CANAL</div><div class="lv">${n.channel}</div></div>
                            <div class="lnet-row"><div class="lk">RSSI</div><div class="lv" style="color:${rssiColor(n.rssi)}">${n.rssi} dBm</div></div>
                            <div class="lnet-row"><div class="lk">CALLE</div><div class="lv">${n.calle || '--'}</div></div>
                            <div class="lnet-row"><div class="lk">CIUDAD</div><div class="lv">${n.ciudad || '--'}</div></div>
                            <div class="lnet-row" style="grid-column:1/-1;"><div class="lk">VISTO</div><div class="lv" style="font-size:11px;">${n.last_seen}</div></div>
                        </div>`;
                }

                // Intel / Resumen inteligente
                renderIntel(db, data);
            }

            // ── PROCESO WARDRIVING ────────────────────────────────────────────
            if (data.wardriving) {
                const w = data.wardriving;
                const procs = [
                    { name: 'wardriving.sh', active: w.script_active,  desc: 'Script principal' },
                    { name: 'tshark',        active: w.tshark_active,  desc: 'Captura de paquetes' },
                    { name: 'ch_hopper',     active: w.hopper_active,  desc: 'Channel hopper (iw)' },
                    { name: 'wlan1 mode',    active: w.iface_mode === 'MONITOR', desc: 'Modo: ' + (w.iface_mode || '??') },
                ];
                document.getElementById('proc-list').innerHTML = procs.map(p =>
                    `<div class="proc-item ${p.active ? 'on' : 'off'}">
                        <div>
                            <div style="font-weight:bold; font-size:11px;">${p.name}</div>
                            <div style="font-size:9px; opacity:0.5;">${p.desc}</div>
                        </div>
                        <div class="proc-status ${p.active ? 'on' : 'off'}">${p.active ? 'RUNNING' : 'STOPPED'}</div>
                    </div>`
                ).join('');
            }

            // ── LIVE FEED ─────────────────────────────────────────────────────
            if (data.live_feed && data.live_feed.length) {
                const feed = data.live_feed;
                const newBssids = feed.map(f => f.bssid);

                document.getElementById('live-feed-list').innerHTML = feed.map(n => {
                    const isNew = !prevFeedBssids.includes(n.bssid);
                    const sc = secColor(n.security);
                    const rc = rssiColor(n.rssi);
                    const timeStr = n.last_seen ? n.last_seen.split(' ')[1]?.substring(0,5) : '--';
                    return `<div class="feed-item${isNew ? ' new-entry' : ''}">
                        <div class="feed-dot" style="background:${rc};"></div>
                        <div class="feed-ssid">${n.ssid || '[HIDDEN]'}</div>
                        <div class="feed-sec" style="color:${sc}; border-color:${sc};">${n.security}</div>
                        <div class="feed-rssi" style="color:${rc};">${n.rssi}</div>
                        <div class="feed-time">${timeStr}</div>
                    </div>`;
                }).join('');

                prevFeedBssids = newBssids;
            }
        }

        // ── INTEL SUMMARY ─────────────────────────────────────────────────────
        function renderIntel(db, data) {
            const items = [];

            // Ratio WPA3
            const wpa3 = db.sec_dist['WPA3'] || 0;
            const total = db.total || 1;
            const wpa3pct = (wpa3/total*100).toFixed(1);
            items.push({ type: 'info', text: `WPA3 adoptado en el <b>${wpa3pct}%</b> de las redes capturadas.` });

            // Open ratio
            if (db.open_count > 0) {
                items.push({ type: 'warn', text: `<b>${db.open_count}</b> redes abiertas detectadas — posibles honeypots o redes públicas.` });
            }

            // Actividad 24h
            if (db.new_24h > 0) {
                items.push({ type: 'info', text: `<b>${db.new_24h}</b> nodo(s) detectado(s) o actualizado(s) en las últimas 24 horas.` });
            } else {
                items.push({ type: 'warn', text: 'Sin actividad reciente en las últimas 24 horas.' });
            }

            // GPS sin fix
            if (data.gps && data.gps.mode < 2) {
                items.push({ type: 'danger', text: 'GPS sin fix — los beacons capturados no serán geolocalizados.' });
            }

            // Wardriving inactivo
            if (data.wardriving && !data.wardriving.tshark_active) {
                items.push({ type: 'danger', text: 'tshark no está corriendo — la captura está DETENIDA.' });
            }

            // Canal más activo
            if (db.ch_dist) {
                const topCh = Object.entries(db.ch_dist).sort((a,b) => b[1]-a[1])[0];
                if (topCh) items.push({ type: 'info', text: `Canal más concurrido: <b>CH${topCh[0]}</b> con ${topCh[1]} redes.` });
            }

            document.getElementById('intel-box').innerHTML = items.map(i =>
                `<div class="alert-box ${i.type}">${i.text}</div>`
            ).join('');
        }

        // ── POLLING ───────────────────────────────────────────────────────────
        let syncDot = document.getElementById('sync-indicator');

        async function fetchStatus() {
            try {
                const res = await fetch('status_api.php?_=' + Date.now());
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                render(data);
                syncDot.style.background = 'var(--green)';
            } catch(e) {
                console.error('Status fetch error:', e);
                syncDot.style.background = 'var(--red)';
            }
        }

        fetchStatus();
        setInterval(fetchStatus, 3000);