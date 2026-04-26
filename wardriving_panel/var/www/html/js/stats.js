/*
 * Copyright (c) 2026 Álvaro Rubio Adán
 * Licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
 * Usage and modification permitted with attribution to the author.
 */

function toggleMenu() { $('#nav-menu').toggleClass('active'); $('#menu-overlay').toggle(); }

Chart.defaults.color = '#c4cfdd';
Chart.defaults.font.family = 'Consolas';

const WETO_PALETTE = ['#7000ff','#00f2ff','#e74c3c','#f1c40f','#2ecc71','#3498db','#9b59b6','#e67e22','#1abc9c','#d35400'];

// ─── HELPERS ────────────────────────────────────────────────────────────────

function makeClickable(chart, keyFn) {
    chart.options.onClick = (e) => {
        const pts = e.chart.getElementsAtEventForMode(e, 'index', { intersect: false }, true);
        if (pts.length) {
            const key = keyFn(e.chart, pts[0].index);
            if (key) window.location.href = `index.html?search=${encodeURIComponent(key)}`;
        }
    };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

fetch('get_data.php?length=100000')
    .then(r => r.json())
    .then(res => {
        const rawData = res.data;
        if (!rawData || !rawData.length) return;

        // ── Aggregate counters ───────────────────────────────────────────────
        const cityC = {}, vendorC = {}, authC = {}, ssidC = {}, channelC = {};
        const dayHourMatrix = Array.from({length:7}, () => new Array(24).fill(0));
        const dayCount = {};
        // encryption trend: per day counts for OPEN, WPA2, WPA3
        const daySecCount = {};
        let totalRSSI = 0, openCount = 0, wpa3Count = 0;
        const rssiDist = { excellent:0, good:0, fair:0, poor:0 };

        rawData.forEach(r => {
            // City / vendor / auth
            const city   = r.ciudad || 'UNKNOWN';
            const vendor = r.v      || 'UNKNOWN';
            const sec    = (r.sec   || 'UNKNOWN').toUpperCase();
            const ssid   = r.s      || 'HIDDEN';
            const ch     = r.ch     ? String(r.ch) : 'UNK';
            cityC[city]     = (cityC[city]   || 0) + 1;
            vendorC[vendor] = (vendorC[vendor]|| 0) + 1;
            authC[sec]      = (authC[sec]    || 0) + 1;
            ssidC[ssid]     = (ssidC[ssid]   || 0) + 1;
            channelC[ch]    = (channelC[ch]  || 0) + 1;

            // RSSI
            const rssi = parseInt(r.r) || 0;
            totalRSSI += rssi;
            if (rssi > -60)       rssiDist.excellent++;
            else if (rssi > -75)  rssiDist.good++;
            else if (rssi > -85)  rssiDist.fair++;
            else                  rssiDist.poor++;

            // Open networks
            if (sec === 'OPEN' || sec === '' || sec === 'NONE') openCount++;
            if (sec === 'WPA3' || sec === 'WPA2/WPA3') wpa3Count++;

            // Day × hour heatmap  (last_seen field: "YYYY-MM-DD HH:MM:SS")
            if (r.t) {
                const d = new Date(r.t.replace(' ','T'));
                if (!isNaN(d)) {
                    const dow = d.getDay();
                    const hr  = d.getHours();
                    dayHourMatrix[dow][hr]++;
                    const dateKey = r.t.substring(0,10);
                    dayCount[dateKey] = (dayCount[dateKey] || 0) + 1;
                    // Encryption trend per day
                    if (!daySecCount[dateKey]) daySecCount[dateKey] = { OPEN:0, WPA2:0, WPA3:0, OTHER:0 };
                    if (sec === 'OPEN' || sec === 'NONE' || sec === '') daySecCount[dateKey].OPEN++;
                    else if (sec === 'WPA3' || sec === 'WPA2/WPA3') daySecCount[dateKey].WPA3++;
                    else if (sec === 'WPA2' || sec === 'WPA2-ENT') daySecCount[dateKey].WPA2++;
                    else daySecCount[dateKey].OTHER++;
                }
            }
        });

        const total = rawData.length;
        const avgRSSI = Math.round(totalRSSI / total);
        const securedPct = Math.round(((total - openCount) / total) * 100);

        // ── KPI row ──────────────────────────────────────────────────────────
        $('#kpi-total').text(total.toLocaleString());
        $('#kpi-open').text(openCount.toLocaleString());
        $('#kpi-cities').text(Object.keys(cityC).length);
        $('#kpi-vendors').text(Object.keys(vendorC).length);
        $('#kpi-avg-rssi').text(avgRSSI + ' dBm');
        $('#kpi-wpa3').text(wpa3Count.toLocaleString());

        // ── 1. RSSI Chronological line ───────────────────────────────────────
        const allRSSI = [...rawData].reverse().map(r => parseInt(r.r));
        new Chart($('#signalLineChart'), {
            type: 'line',
            data: {
                labels: allRSSI.map(() => ''),
                datasets: [{
                    data: allRSSI,
                    borderColor: '#00f2ff', borderWidth: 1.5,
                    backgroundColor: 'rgba(0,242,255,0.07)',
                    fill: true, pointRadius: 0, tension: 0.2
                }]
            },
            options: {
                animation: false,
                scales: {
                    x: { display: false },
                    y: { grid: { color: '#1e2430' }, title: { display: true, text: 'dBm' } }
                },
                plugins: { legend: { display: false } }
            }
        });

        // ── 2. Security Gauge (doughnut) ─────────────────────────────────────
        $('#gauge-pct').text(securedPct + '%');
        const gaugeCtx = document.getElementById('gaugeChart');
        new Chart(gaugeCtx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [securedPct, 100 - securedPct],
                    backgroundColor: ['#2ecc71', '#e74c3c'],
                    borderWidth: 0,
                    circumference: 180,
                    rotation: 270
                }]
            },
            options: {
                cutout: '72%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            }
        });

        // Security breakdown pills — clickables
        const secSorted = Object.entries(authC).sort((a,b) => b[1]-a[1]);
        const pillsHtml = secSorted.map(([k,v], i) => {
            const col = WETO_PALETTE[i % WETO_PALETTE.length];
            const pct = Math.round((v/total)*100);
            return `<span class="sec-pill" style="border-color:${col};color:${col};cursor:pointer"
                onclick="location.href='index.html?search=${encodeURIComponent(k)}'"
                title="Ver redes ${k}">${k} <b>${pct}%</b></span>`;
        }).join('');
        $('#sec-breakdown').html(pillsHtml);

        // ── 3. RSSI distribution (bar, coloured by quality) ──────────────────
        const rssiKeys = ['excellent', 'good', 'fair', 'poor'];
        const rssiChart = new Chart($('#rssiDistChart'), {
            type: 'bar',
            data: {
                labels: ['Excellent\n>-60', 'Good\n-60/-75', 'Fair\n-75/-85', 'Poor\n<-85'],
                datasets: [{
                    data: [rssiDist.excellent, rssiDist.good, rssiDist.fair, rssiDist.poor],
                    backgroundColor: ['#2ecc71','#f1c40f','#e67e22','#e74c3c'],
                    borderRadius: 6
                }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: { y: { grid: { color: '#1e2430' } } }
            }
        });
        makeClickable(rssiChart, (ch, i) => 'rssi:' + rssiKeys[i]);

        // ── 4. TOP 10 CITIES ─────────────────────────────────────────────────
        const topCities = Object.entries(cityC).sort((a,b) => b[1]-a[1]).slice(0,10);
        const cityChart = new Chart($('#cityChart'), {
            type: 'bar',
            data: {
                labels: topCities.map(c => c[0]),
                datasets: [{ data: topCities.map(c => c[1]), backgroundColor: WETO_PALETTE, borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: { x: { grid: { color: '#1e2430' } } }
            }
        });
        makeClickable(cityChart, (ch, i) => ch.data.labels[i]);

        // ── 5. TOP 10 VENDORS ────────────────────────────────────────────────
        const topV = Object.entries(vendorC).sort((a,b) => b[1]-a[1]).slice(0,10);
        const vendorChart = new Chart($('#vendorChart'), {
            type: 'bar',
            data: {
                labels: topV.map(v => v[0]),
                datasets: [{ data: topV.map(v => v[1]), backgroundColor: WETO_PALETTE, borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: { x: { grid: { color: '#1e2430' } } }
            }
        });
        makeClickable(vendorChart, (ch, i) => ch.data.labels[i]);

        // ── 6. CHANNEL DISTRIBUTION ──────────────────────────────────────────
        const chSorted = Object.entries(channelC)
            .filter(([k]) => k !== 'UNK')
            .sort((a,b) => parseInt(a[0]) - parseInt(b[0]));
        const ch24 = chSorted.filter(([k]) => parseInt(k) <= 14);
        const ch5  = chSorted.filter(([k]) => parseInt(k) > 14);

        const channelChart = new Chart($('#channelChart'), {
            type: 'bar',
            data: {
                labels: chSorted.map(([k]) => 'CH' + k),
                datasets: [{
                    label: '2.4 GHz',
                    data: chSorted.map(([k,v]) => parseInt(k) <= 14 ? v : null),
                    backgroundColor: 'rgba(112,0,255,0.75)',
                    borderRadius: 4
                },{
                    label: '5 GHz',
                    data: chSorted.map(([k,v]) => parseInt(k) > 14 ? v : null),
                    backgroundColor: 'rgba(0,242,255,0.65)',
                    borderRadius: 4
                }]
            },
            options: {
                plugins: { legend: { display: true, position: 'top' } },
                scales: { y: { grid: { color: '#1e2430' } }, x: { grid: { color: '#1e2430' } } }
            }
        });
        // Pass the raw channel number (no "CH" prefix) so table.js matches r.ch
        makeClickable(channelChart, (ch, i) => chSorted[i][0]);

        // ── 7. HEATMAP (day × hour) ──────────────────────────────────────────
        buildHeatmap(dayHourMatrix);

        // ── 8. ACTIVITY PER DAY (captures timeline) ──────────────────────────
        const sortedDays = Object.entries(dayCount).sort((a,b) => a[0].localeCompare(b[0]));
        const activityChart = new Chart($('#activityChart'), {
            type: 'bar',
            data: {
                labels: sortedDays.map(([d]) => d),
                datasets: [{
                    label: 'Captures',
                    data: sortedDays.map(([,v]) => v),
                    backgroundColor: 'rgba(0,242,255,0.5)',
                    borderColor: '#00f2ff',
                    borderWidth: 1,
                    borderRadius: 3
                }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: '#1e2430' }, ticks: { maxTicksLimit: 20 } },
                    y: { grid: { color: '#1e2430' } }
                }
            }
        });
        // Pass the date string (YYYY-MM-DD) — table.js matches against r.t which is "YYYY-MM-DD HH:MM:SS"
        makeClickable(activityChart, (ch, i) => ch.data.labels[i]);

        // ── 9. TOP 10 REPEATED SSIDs ─────────────────────────────────────────
        const topSSID = Object.entries(ssidC).sort((a,b) => b[1]-a[1]).slice(0,10);
        const ssidChart = new Chart($('#ssidChart'), {
            type: 'bar',
            data: {
                labels: topSSID.map(([k]) => k),
                datasets: [{ data: topSSID.map(([,v]) => v), backgroundColor: WETO_PALETTE, borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: { x: { grid: { color: '#1e2430' } } }
            }
        });
        makeClickable(ssidChart, (ch, i) => ch.data.labels[i]);

        // ── 10. ENCRYPTION TREND OVER TIME ───────────────────────────────────
        const trendDays = Object.keys(daySecCount).sort();
        new Chart($('#encTrendChart'), {
            type: 'line',
            data: {
                labels: trendDays,
                datasets: [
                    {
                        label: 'OPEN',
                        data: trendDays.map(d => daySecCount[d].OPEN),
                        borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.08)',
                        borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.3
                    },
                    {
                        label: 'WPA2',
                        data: trendDays.map(d => daySecCount[d].WPA2),
                        borderColor: '#f1c40f', backgroundColor: 'rgba(241,196,15,0.06)',
                        borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.3
                    },
                    {
                        label: 'WPA3',
                        data: trendDays.map(d => daySecCount[d].WPA3),
                        borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,0.08)',
                        borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.3
                    },
                    {
                        label: 'OTHER',
                        data: trendDays.map(d => daySecCount[d].OTHER),
                        borderColor: '#7000ff', backgroundColor: 'rgba(112,0,255,0.05)',
                        borderWidth: 1, fill: true, pointRadius: 0, tension: 0.3
                    }
                ]
            },
            options: {
                animation: false,
                scales: {
                    x: { grid: { color: '#1e2430' }, ticks: { maxTicksLimit: 20 } },
                    y: { grid: { color: '#1e2430' }, beginAtZero: true }
                },
                plugins: { legend: { display: true, position: 'top' } }
            }
        });

        // ── 11. BEST / WORST RSSI RECORDS ────────────────────────────────────
        const sorted = [...rawData]
            .filter(r => r.r !== null && r.r !== undefined && r.r !== '')
            .sort((a,b) => parseInt(b.r) - parseInt(a.r));
        const rssiRowHtml = (r) => {
            const rssi = parseInt(r.r);
            const col = rssi > -60 ? '#2ecc71' : rssi > -75 ? '#f1c40f' : rssi > -85 ? '#e67e22' : '#e74c3c';
            const ssid = (r.s || 'HIDDEN').substring(0,22);
            const vendor = (r.v || '?').substring(0,16);
            return `<div class="rssi-rec-row">
                <span class="rssi-rec-ssid" title="${r.s || ''}">${ssid}</span>
                <span class="rssi-rec-vendor">${vendor}</span>
                <span class="rssi-rec-val" style="color:${col}">${rssi} dBm</span>
            </div>`;
        };
        $('#best-rssi-table').html(sorted.slice(0, 5).map(rssiRowHtml).join(''));
        $('#worst-rssi-table').html(sorted.slice(-5).reverse().map(rssiRowHtml).join(''));

        // ── 12. PROTOCOLS & SECURITY (bar) ───────────────────────────────────
        const authChart = new Chart($('#authChart'), {
            type: 'bar',
            data: {
                labels: Object.keys(authC),
                datasets: [{ data: Object.values(authC), backgroundColor: WETO_PALETTE, borderRadius: 4 }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: { y: { grid: { color: '#1e2430' } } }
            }
        });
        makeClickable(authChart, (ch, i) => ch.data.labels[i]);

        // ── Tables ───────────────────────────────────────────────────────────
        fillTable('cityTable', cityC);
        fillTable('vendorTable', vendorC);
    });

// ─── HEATMAP (SVG-based, day × hour) ────────────────────────────────────────

function buildHeatmap(matrix) {
    const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const cellW = 32, cellH = 28, padL = 46, padT = 28;
    const W = padL + 24 * cellW + 10;
    const H = padT + 7 * cellH + 24;

    // Find max for colour scaling
    let maxVal = 0;
    matrix.forEach(row => row.forEach(v => { if (v > maxVal) maxVal = v; }));
    if (maxVal === 0) maxVal = 1;

    function cellColor(v) {
        const t = v / maxVal;
        if (t === 0) return '#1a1f2a';
        // gradient: dark blue → cyan → purple
        const r = Math.round(112 * t);
        const g = Math.round(242 * t);
        const b = Math.round(255 * (0.3 + 0.7 * t));
        return `rgb(${r},${g},${b})`;
    }

    let cells = '';
    // Hour labels (top)
    for (let h = 0; h < 24; h++) {
        cells += `<text x="${padL + h * cellW + cellW/2}" y="${padT - 8}" 
            text-anchor="middle" font-size="9" fill="#5a6476">${h < 10 ? '0'+h : h}</text>`;
    }
    // Day rows
    matrix.forEach((row, dow) => {
        cells += `<text x="${padL - 6}" y="${padT + dow * cellH + cellH/2 + 4}" 
            text-anchor="end" font-size="10" fill="#8899aa">${days[dow]}</text>`;
        row.forEach((val, hr) => {
            const x = padL + hr * cellW;
            const y = padT + dow * cellH;
            cells += `<rect x="${x+1}" y="${y+1}" width="${cellW-2}" height="${cellH-2}" 
                rx="3" fill="${cellColor(val)}">
                <title>${days[dow]} ${hr < 10 ? '0'+hr : hr}:00 — ${val} captures</title>
            </rect>`;
        });
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}"
        style="display:block; max-width:100%; overflow:visible;">
        ${cells}
        <text x="${padL + 12 * cellW}" y="${H - 2}" text-anchor="middle" 
            font-size="9" fill="#3a4455">HOUR OF DAY (local time)</text>
    </svg>`;

    $('#heatmap-wrap').html(svg);
}

// ─── TABLE FILL ──────────────────────────────────────────────────────────────

function fillTable(id, obj) {
    const tbody = $(`#${id} tbody`);
    Object.entries(obj).sort((a,b) => b[1]-a[1]).forEach(([k, v]) => {
        const row = $(`<tr class="clickable"><td>${k}</td><td class="count">${v}</td></tr>`);
        row.on('click', () => { window.location.href = `index.html?search=${encodeURIComponent(k)}`; });
        tbody.append(row);
    });
}
