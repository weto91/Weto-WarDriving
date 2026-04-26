// ── Config ──
        const PAGE_SIZE = 20;
        let allData = [], filtered = [], currentPage = 1, searchTimeout;

        // ── Colors ──
        const SEC_COLORS = {
            'WPA3':'#e74c3c','WPA2/WPA3':'#c0392b','WPA2-ENT':'#9b59b6','WPA2':'#e67e22',
            'WPA/WPA2':'#d35400','WPA':'#f39c12','WEP':'#2ecc71','OWE':'#00d2ff',
            'OPEN':'#3498db','WAPI':'#1abc9c','UNKNOWN':'#555'
        };
        const SIG_COL = r => r > -60 ? '#2ecc71' : (r > -80 ? '#f1c40f' : '#e74c3c');
        const secCol = s => SEC_COLORS[(s||'').toUpperCase()] || '#555';

        // ── Nav ──
        function toggleMenu() {
            const m = document.getElementById('nav-menu');
            const o = document.getElementById('menu-overlay');
            m.classList.toggle('active');
            o.style.display = m.classList.contains('active') ? 'block' : 'none';
        }

        // ── Carga datos ──
        fetch('get_data.php?length=99999')
            .then(r => r.json())
            .then(res => {
                allData = res.data || [];
                // Leer parámetro search de URL
                const urlParams = new URLSearchParams(window.location.search);
                const s = urlParams.get('search');
                if (s) { document.getElementById('search-input').value = s; }
                applyFilter();
            })
            .catch(() => {
                document.getElementById('card-list').innerHTML = '<div id="loading" style="color:#e74c3c">ERROR_CARGANDO_DATOS</div>';
            });

        // ── Búsqueda ──
        document.getElementById('search-input').addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => { currentPage = 1; applyFilter(); }, 250);
        });

        function applyFilter() {
            const q = document.getElementById('search-input').value.toLowerCase().trim();
            if (!q) {
                filtered = allData;
            } else if (q.startsWith('rssi:')) {
                // Special RSSI range filter: rssi:excellent | good | fair | poor
                const range = q.split(':')[1];
                filtered = allData.filter(r => {
                    const rssi = parseInt(r.r) || -999;
                    if (range === 'excellent') return rssi > -60;
                    if (range === 'good')      return rssi <= -60 && rssi > -75;
                    if (range === 'fair')      return rssi <= -75 && rssi > -85;
                    if (range === 'poor')      return rssi <= -85;
                    return false;
                });
            } else {
                filtered = allData.filter(r =>
                    (r.s||'').toLowerCase().includes(q) ||
                    (r.m||'').toLowerCase().includes(q) ||
                    (r.v||'').toLowerCase().includes(q) ||
                    (r.ciudad||'').toLowerCase().includes(q) ||
                    (r.calle||'').toLowerCase().includes(q) ||
                    (r.sec||'').toLowerCase().includes(q) ||
                    String(r.ch||'').includes(q) ||
                    (r.t||'').includes(q)
                );
            }
            renderPage();
        }

        function renderPage() {
            const list = document.getElementById('card-list');
            const start = (currentPage - 1) * PAGE_SIZE;
            const page = filtered.slice(start, start + PAGE_SIZE);
            const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

            if (page.length === 0) {
                list.innerHTML = '<div id="loading" style="color:#555">SIN_RESULTADOS</div>';
            } else {
                list.innerHTML = page.map((d, i) => buildCard(d, start + i)).join('');
            }

            // Paginación
            const pgEl = document.getElementById('pagination');
            pgEl.style.display = filtered.length > PAGE_SIZE ? 'flex' : 'none';
            document.getElementById('pg-info').textContent = `${currentPage} / ${totalPages}`;
            document.getElementById('pg-prev').disabled = currentPage <= 1;
            document.getElementById('pg-next').disabled = currentPage >= totalPages;
        }

        function buildCard(d, idx) {
            const rssi = parseInt(d.r);
            const sc = secCol(d.sec);
            const sigc = SIG_COL(rssi);
            const ssid = d.s ? `<span class="net-ssid">${escHtml(d.s)}</span>` : `<span class="net-ssid hidden">[HIDDEN]</span>`;
            const dateStr = d.t ? d.t.split(' ')[0] : '';
            const city = d.ciudad && d.ciudad !== 'unknown' ? d.ciudad : '';
            const street = d.calle && d.calle !== 'unknown' ? d.calle : '';
            const metaStr = [city, street].filter(Boolean).join(' · ') || (d.v || '');

            return `<div class="net-card" onclick="showDetail(${idx})">
                <div class="net-icon">
                    <div class="outer" style="background:${sigc}"></div>
                    <div class="inner" style="background:${sc}"></div>
                </div>
                <div class="net-info">
                    ${ssid}
                    <div class="net-meta"><span>${escHtml(metaStr)}</span></div>
                </div>
                <div class="net-right">
                    <div class="net-sec" style="color:${sc};border-color:${sc};">${escHtml(d.sec||'?')}</div>
                    <div class="net-date">${dateStr}</div>
                </div>
            </div>`;
        }

        function escHtml(s) {
            return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        function showDetail(idx) {
            const start = (currentPage - 1) * PAGE_SIZE;
            const d = filtered[start + idx];
            if (!d) return;

            document.getElementById('modal-ssid').textContent = d.s || '[HIDDEN]';
            const fields = [
                { l: 'BSSID', v: d.m },
                { l: 'VENDOR', v: d.v },
                { l: 'SEÑAL', v: `<span style="color:${SIG_COL(parseInt(d.r))}">${d.r} dBm</span>` },
                { l: 'SEGURIDAD', v: `<span style="color:${secCol(d.sec)}">${d.sec}</span>` },
                { l: 'CIFRADO', v: d.c },
                { l: 'CANAL', v: d.ch },
                { l: 'CIUDAD', v: d.ciudad },
                { l: 'CALLE', v: d.calle },
                { l: 'GPS', v: `${d.la}, ${d.lo}` },
                { l: 'VISTO', v: d.t }
            ];
            document.getElementById('modal-body').innerHTML = fields.map(f =>
                `<div class="detail-row"><div class="d-label">${f.l}</div><div class="d-value">${f.v||'—'}</div></div>`
            ).join('');
            document.getElementById('maps-link').href = `https://www.google.com/maps?q=${d.la},${d.lo}`;
            document.getElementById('detailModal').classList.add('open');
        }

        function closeModal() {
            document.getElementById('detailModal').classList.remove('open');
        }

        function changePage(dir) {
            const total = Math.ceil(filtered.length / PAGE_SIZE);
            currentPage = Math.max(1, Math.min(total, currentPage + dir));
            renderPage();
            window.scrollTo(0, 0);
        }

        // Cerrar modal tocando fuera
        document.getElementById('detailModal').addEventListener('click', function(e) {
            if (e.target === this) closeModal();
        });