var map, markersLayer, wifiData = [], groupedByCoord = {}, currentPopupNets = [];
        var layers = {};
        var activeFilters = { 
            sig: ['exc', 'ok', 'bad'], 
            sec: ['OPEN', 'OWE', 'WEP', 'WPA', 'WPA2', 'WPA/WPA2', 'WPA2-ENT', 'WPA3', 'WPA2/WPA3', 'WAPI', 'UNKNOWN'] 
        };

        const getSigCat = (r) => r > -60 ? 'exc' : (r > -80 ? 'ok' : 'bad');
        const getSigCol = (c) => c === 'exc' ? '#2ecc71' : (c === 'ok' ? '#f1c40f' : '#e74c3c');
        const getSecCat = (s) => {
            const val = (s || '').toUpperCase();
            const validos = ['OPEN', 'OWE', 'WEP', 'WPA', 'WPA2', 'WPA/WPA2', 'WPA2-ENT', 'WPA3', 'WPA2/WPA3', 'WAPI'];
            return validos.includes(val) ? val : 'UNKNOWN';
        };
        const getSecCol = (c) => {
            const colors = {'OPEN':'#3498db','OWE':'#00d2ff','WEP':'#2ecc71','WPA':'#f39c12','WPA2':'#e67e22','WPA/WPA2':'#d35400','WPA2-ENT':'#9b59b6','WPA3':'#e74c3c','WPA2/WPA3':'#c0392b','WPA3-ENT192':'#8e44ad','WAPI':'#1abc9c','UNKNOWN':'#7f8c8d'};
            return colors[c] || '#7f8c8d';
        };

        function renderFullDetail(r, showBack = false) {
            return `<div class="popup-container">
                ${showBack ? `<div class="back-btn" onclick="event.stopPropagation(); window.restoreListView()">« VOLVER AL LISTADO</div>` : ''}
                <div class="popup-header"><h3>📡 ${r.s || '--HIDDEN--'}</h3></div>
                <div class="detail-row"><span class="detail-label">BSSID</span><span class="detail-val" style="color:var(--primary); font-family:monospace;">${r.m}</span></div>
                <div class="detail-row"><span class="detail-label">Fabricante</span><span class="detail-val">${r.v}</span></div>
                <div class="detail-row"><span class="detail-label">Seguridad</span><span class="detail-val" style="color:${getSecCol(getSecCat(r.sec))}">${r.sec}</span></div>
                <div class="detail-row"><span class="detail-label">Cifrado</span><span class="detail-val">${r.c || '---'}</span></div>
                <div class="detail-row"><span class="detail-label">Canal</span><span class="detail-val">${r.ch}</span></div>
                <div class="detail-row"><span class="detail-label">Señal</span><span class="detail-val" style="color:${getSigCol(getSigCat(r.r))}">${r.r} dBm</span></div>
                <div class="detail-row"><span class="detail-label">Calle</span><span class="detail-val">${r.calle || 'No disponible'}</span></div>
                <div class="detail-row"><span class="detail-label">Ciudad</span><span class="detail-val">${r.ciudad || 'No disponible'}</span></div>
                <div class="detail-row"><span class="detail-label">GEO</span><span class="detail-val" style="font-size:9px;">${r.la}, ${r.lo}</span></div>
                <div class="detail-row" style="border:none; opacity:0.5; margin-top:8px;"><span class="detail-label">SINC</span><span class="detail-val">${r.t}</span></div>
            </div>`;
        }

        function buildHTMLList(nets) {
            let html = `<div class="popup-container"><div class="popup-header"><h3>NODOS_DETECTADOS (${nets.length})</h3></div><div class="cluster-list">`;
            nets.forEach((n, i) => {
                html += `<div class="cluster-item" onclick="event.stopPropagation(); window.showDetailView(${i})">
                    <div class="status-icon-mini">
                        <div class="circle-out-mini" style="background:${getSigCol(getSigCat(n.r))}"></div>
                        <div class="circle-in-mini" style="background:${getSecCol(getSecCat(n.sec))}"></div>
                    </div>
                    <span style="flex-grow:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${n.s || '--HIDDEN--'}</span>
                    <span style="color:${getSigCol(getSigCat(n.r))}; font-weight:bold; margin-left:10px;">${n.r}</span>
                </div>`;
            });
            return html + "</div></div>";
        }

        window.showDetailView = function(idx) {
            const net = currentPopupNets[idx];
            if(net && map._popup) map._popup.setContent(renderFullDetail(net, true));
        };

        window.restoreListView = function() {
            if(map._popup) map._popup.setContent(buildHTMLList(currentPopupNets));
        };

        function toggleMenu() {
            const m = document.getElementById('nav-menu');
            const o = document.getElementById('menu-overlay');
            m.classList.toggle('active');
            o.style.display = m.classList.contains('active') ? 'block' : 'none';
        }

        function togglePanel() {
            document.getElementById('info-panel').classList.toggle('open');
        }

        function toggleLayerMenu() {
            const menu = document.getElementById('layer-menu');
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        }

        function setLayer(name) {
            Object.values(layers).forEach(l => map.removeLayer(l));
            map.addLayer(layers[name]);
            document.getElementById('layer-menu').style.display = 'none';
        }

        function init() {
            layers.night = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 23, maxNativeZoom: 19 });
            layers.day   = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 23, maxNativeZoom: 19 });
            layers.vibrant = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 23, maxNativeZoom: 19 });

            map = L.map('map', { maxZoom: 23, layers: [layers.night], zoomControl: false }).setView([40.41, -3.7], 13);
            L.control.zoom({ position: 'bottomright' }).addTo(map);

            markersLayer = L.markerClusterGroup({
                maxClusterRadius: 40, zoomToBoundsOnClick: false, spiderfyOnMaxZoom: true,
                iconCreateFunction: function(cluster) {
                    const markers = cluster.getAllChildMarkers();
                    let totalCount = 0;
                    markers.forEach(m => totalCount += (m.options.netCount || 1));
                    const rep = markers[0].options.repData;
                    return L.divIcon({
                        html: `<div style="position:relative; width:22px; height:22px;">
                                    <div style="background:${getSigCol(getSigCat(rep.r))}; width:22px; height:22px; border-radius:50%; border:1px solid #000; opacity:0.8;"></div>
                                    <div style="background:${getSecCol(getSecCat(rep.sec))}; width:8px; height:8px; border-radius:50%; border:1px solid #fff; position:absolute; top:7px; left:7px;"></div>
                                    <div class="count-badge">${totalCount}</div>
                               </div>`,
                        className: '', iconSize: [22, 22]
                    });
                }
            });

            markersLayer.on('clusterclick', function (a) {
                let allNets = [];
                a.layer.getAllChildMarkers().forEach(m => {
                    const nets = groupedByCoord[m.options.coordKey];
                    if(nets) allNets = allNets.concat(nets);
                });
                currentPopupNets = allNets;
                L.popup().setLatLng(a.latlng).setContent(buildHTMLList(allNets)).openOn(map);
            });

            map.addLayer(markersLayer);
            map.on('moveend', updateStats);

            // Bloquear propagación de clics del popup al mapa (evita cierre fantasma)
            map.on('popupopen', function(e) {
                var el = e.popup.getElement();
                if (el) {
                    L.DomEvent.disableClickPropagation(el);
                    L.DomEvent.disableScrollPropagation(el);
                }
            });

            // Sincronización con el nuevo formato de get_data.php
            fetch('get_data.php?length=99999').then(r => r.json()).then(res => {
                wifiData = res.data.map(d => ({ ...d, la: parseFloat(d.la), lo: parseFloat(d.lo), r: parseInt(d.r) }));
                updateMap();
                if(wifiData.length) {
                    map.fitBounds(wifiData.map(r => [r.la, r.lo]), {padding:[50,50]});
                    setTimeout(updateStats, 500);
                }
            });
        }

        function updateMap() {
            markersLayer.clearLayers();
            groupedByCoord = {};
            wifiData.forEach(red => {
                const sCat = getSigCat(red.r), aCat = getSecCat(red.sec);
                if(activeFilters.sig.includes(sCat) && activeFilters.sec.includes(aCat)) {
                    const k = red.la.toFixed(6) + "_" + red.lo.toFixed(6);
                    if(!groupedByCoord[k]) groupedByCoord[k] = [];
                    groupedByCoord[k].push(red);
                }
            });

            for(let k in groupedByCoord) {
                const nets = groupedByCoord[k], win = nets[0];
                const marker = L.marker([win.la, win.lo], {
                    coordKey: k, netCount: nets.length, repData: win,
                    icon: L.divIcon({
                        html: `<div style="position:relative; width:22px; height:22px;">
                                    <div style="background:${getSigCol(getSigCat(win.r))}; width:22px; height:22px; border-radius:50%; border:1px solid #000; opacity:0.8;"></div>
                                    <div style="background:${getSecCol(getSecCat(win.sec))}; width:8px; height:8px; border-radius:50%; border:1px solid #fff; position:absolute; top:7px; left:7px;"></div>
                                    ${nets.length > 1 ? `<div class="count-badge">${nets.length}</div>` : ''}
                               </div>`,
                        className: '', iconSize: [22, 22]
                    })
                });
                
                marker.bindPopup(function() {
                    currentPopupNets = nets;
                    return (nets.length === 1) ? renderFullDetail(nets[0]) : buildHTMLList(nets);
                }, { autoClose: true });

                markersLayer.addLayer(marker);
            }
            updateStats();
        }

        function updateStats() {
            if (!map || !wifiData.length) return;
            const bounds = map.getBounds();
            let stats = {exc:0, ok:0, bad:0, OPEN:0, OWE:0, WEP:0, WPA:0, WPA2:0, 'WPA/WPA2':0, 'WPA2-ENT':0, WPA3:0, 'WPA2/WPA3':0, 'WPA3-ENT192':0, WAPI:0, UNKNOWN:0};
            let totalInView = 0;

            wifiData.forEach(n => {
                const sCat = getSigCat(n.r), aCat = getSecCat(n.sec);
                if(activeFilters.sig.includes(sCat) && activeFilters.sec.includes(aCat)) {
                    if(bounds.contains([n.la, n.lo])) {
                        stats[sCat]++; stats[aCat]++; totalInView++;
                    }
                }
            });

            document.getElementById('count').innerText = totalInView;
            document.getElementById('c-exc').innerText = stats.exc;
            document.getElementById('c-ok').innerText = stats.ok;
            document.getElementById('c-bad').innerText = stats.bad;
            for(let key in stats) {
                let id = 's-' + key.replace(/\//g, '_'), el = document.getElementById(id);
                if(el) el.innerText = stats[key];
            }
        }

        function toggleFilter(el, cat, val) {
            el.classList.toggle('inactive');
            const idx = activeFilters[cat].indexOf(val);
            if(idx > -1) activeFilters[cat].splice(idx, 1); else activeFilters[cat].push(val);
            updateMap();
        }

        function locateMe() { if(map) map.locate({setView: true, maxZoom: 17}); }

        function showNoInternet() {
            document.getElementById('no-internet').classList.add('visible');
            document.getElementById('map').style.display = 'none';
            document.getElementById('locate-btn').style.display = 'none';
            document.getElementById('layer-btn').style.display = 'none';
            document.getElementById('info-panel').style.display = 'none';
        }

        function checkConnectivity() {
            return new Promise(function(resolve) {
                var img = new Image();
                var timer = setTimeout(function() { img.src = ''; resolve(false); }, 4000);
                img.onload  = function() { clearTimeout(timer); resolve(true); };
                img.onerror = function() { clearTimeout(timer); resolve(false); };
                img.src = 'https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/dark_all/0/0/0.png?_=' + Date.now();
            });
        }

        window.onload = function() {
            checkConnectivity().then(function(online) {
                if (online) {
                    init();
                } else {
                    showNoInternet();
                }
            });
        };