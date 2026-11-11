/**
 * Modo "Solo máquina": rentabilidad de un equipo de minería sin solar ni baterías.
 * Multi-moneda (BTC, ZEC, LTC+DOGE con minado combinado), halvings y crecimiento de dificultad.
 * Catálogo: js/machines-data.js (generado por tools/build-catalog.js, precios de venta en USD).
 * Datos de red: Worker /network (WhatToMine + CoinGecko) con copia de respaldo local.
 */
var MachineMode = (function() {
    'use strict';

    var NETWORK_URL = 'https://solhash-license.reviewsmarcos.workers.dev/network';
    var STORE_KEY = 'solhash_machine_mode';
    var MONTH_DAYS = 30.44;
    var MONTHS = 60;

    // Copia de respaldo (7 nov 2026) por si el Worker no responde
    var FALLBACK_NET = {
        updatedAt: '2026-11-07T19:00:00Z', usdToEur: 0.8971, fallback: true,
        coins: {
            BTC:  { nethash: 9.51076e20, blockReward: 3.1356, blockTime: 670, lastBlock: 974975, priceUSD: 75698, priceEUR: 67912 },
            ZEC:  { nethash: 3.31875e10, blockReward: 0.41666668, blockTime: 25, lastBlock: 3549185, priceUSD: 1266.87, priceEUR: 1136.57 },
            LTC:  { nethash: 2.99992e15, blockReward: 6.25, blockTime: 140, lastBlock: 3209152, priceUSD: 52.17, priceEUR: 46.8 },
            DOGE: { nethash: 3.48668e15, blockReward: 10000, blockTime: 63, lastBlock: 6448092, priceUSD: 0.071735, priceEUR: 0.064357 }
        }
    };

    // Calendario de halvings: altura del siguiente y tiempo de bloque objetivo
    var HALVING = {
        BTC:  { next: function(b) { return (Math.floor(b / 210000) + 1) * 210000; }, target: 600 },
        LTC:  { next: function(b) { return (Math.floor(b / 840000) + 1) * 840000; }, target: 150 },
        ZEC:  { next: function(b) { return b < 4406400 ? 4406400 : 4406400 + Math.ceil((b - 4406400 + 1) / 1680000) * 1680000; }, target: 75 },
        DOGE: null
    };

    var COIN_GROUPS = {
        'BTC':      { label: 'Bitcoin (BTC)', coins: ['BTC'], growth: 25 },
        'ZEC':      { label: 'Zcash (ZEC)', coins: ['ZEC'], growth: 20 },
        'LTC+DOGE': { label: 'Litecoin + Dogecoin (LTC+DOGE)', coins: ['LTC', 'DOGE'], growth: 15 }
    };
    var COIN_NAMES = { BTC: 'Bitcoin', ZEC: 'Zcash', LTC: 'Litecoin', DOGE: 'Dogecoin' };
    var UNIT_MULT = { 'TH/s': 1e12, 'GH/s': 1e9, 'MH/s': 1e6, 'kSol/s': 1e3 };

    var net = FALLBACK_NET;
    var active = false;
    var chart = null;
    var lastResult = null;
    var state = {
        currency: 'EUR',
        machineId: 's21pp-235t',
        qty: 1,
        price: null,            // precio por equipo en la divisa elegida (null = catálogo)
        freePower: false,
        elecPrice: 0.15,
        poolFee: 2,
        uptime: 97,
        priceGrowth: 0,
        growth: { 'BTC': 25, 'ZEC': 20, 'LTC+DOGE': 15 }
    };

    // ─── Datos ─────────────────────────────────────────────────────────────

    /** Nombre con la entrega si no está disponible ya ("… — Entrega abr 2027") */
    function displayName(m) {
        return m.name + (m.delivery && m.delivery.type !== 'ready' ? ' — ' + m.delivery.label : '');
    }

    function machines() { return (window.MACHINES_DATA && MACHINES_DATA.machines) || []; }
    function getMachine(id) {
        var list = machines();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return list[0];
    }
    function fx() { return state.currency === 'EUR' ? net.usdToEur : 1; }
    function catalogPrice(m) { return Math.round(m.priceUSD * fx()); }
    function coinPrice(tag) { var c = net.coins[tag]; return state.currency === 'EUR' ? c.priceEUR : c.priceUSD; }

    var netListeners = [];
    function loadNetwork() {
        if (!window.fetch) return;
        fetch(NETWORK_URL).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.ok && d.coins && d.coins.BTC) {
                net = d;
                if (active) render();
                for (var i = 0; i < netListeners.length; i++) netListeners[i]();
            }
        }).catch(function() {});
    }

    // ─── Motor ─────────────────────────────────────────────────────────────

    function halvingMonth(tag) {
        var h = HALVING[tag];
        var c = net.coins[tag];
        if (!h || !c) return null;
        var height = h.next(c.lastBlock);
        var secs = (height - c.lastBlock) * h.target;
        var date = new Date(Date.now() + secs * 1000);
        return { coin: tag, month: secs / (MONTH_DAYS * 86400), date: date, height: height };
    }

    /**
     * opts: { machine, qty, price, elecPrice, freePower, poolFee, uptime, priceGrowth, growth }
     * Devuelve proyección mensual de MONTHS meses en la divisa activa.
     */
    function compute(opts) {
        var m = opts.machine;
        var group = COIN_GROUPS[m.coin];
        var hashrate = m.hashrate * UNIT_MULT[m.unit] * opts.qty;
        var uptime = opts.uptime / 100;
        var fee = opts.poolFee / 100;
        var g = (opts.growth[m.coin] || 0) / 100;
        var pg = opts.priceGrowth / 100;
        var kw = m.powerW / 1000 * opts.qty;
        var elecPrice = opts.freePower ? 0 : opts.elecPrice;
        var invest = opts.price * opts.qty;

        var halvings = [];
        for (var i = 0; i < group.coins.length; i++) {
            var hm = halvingMonth(group.coins[i]);
            if (hm) halvings.push(hm);
        }

        var start = deliveryDelay(m);   // meses hasta que el equipo empieza a minar
        var months = [], cum = -invest, roiMonth = null;
        for (var k = 0; k < MONTHS; k++) {
            var years = (k + 0.5) / 12;
            var on = Math.min(1, Math.max(0, k + 1 - start));   // fracción del mes minando
            var row = { month: k + 1, coins: {}, revenue: 0, halving: [], on: on };
            for (var j = 0; j < group.coins.length; j++) {
                var tag = group.coins[j];
                var c = net.coins[tag];
                var reward = c.blockReward;
                for (var h = 0; h < halvings.length; h++) {
                    if (halvings[h].coin === tag && k + 1 > halvings[h].month) reward /= 2;
                    if (halvings[h].coin === tag && Math.ceil(halvings[h].month) === k + 1) row.halving.push(tag);
                }
                var share = hashrate / (c.nethash * Math.pow(1 + g, years));
                var amount = share * reward * (86400 / c.blockTime) * MONTH_DAYS * uptime * (1 - fee) * on;
                row.coins[tag] = amount;
                row.revenue += amount * coinPrice(tag) * Math.pow(1 + pg, years);
            }
            row.elec = kw * 24 * MONTH_DAYS * uptime * elecPrice * on;
            row.profit = row.revenue - row.elec;
            var prev = cum;
            cum += row.profit;
            row.cum = cum;
            if (roiMonth === null && cum >= 0 && invest > 0) {
                roiMonth = k + (row.profit > 0 ? (-prev) / row.profit : 1);
            }
            months.push(row);
        }

        // KPIs mensuales: primer mes completo minando (tras la entrega)
        var first = months[Math.min(MONTHS - 1, Math.ceil(start))];
        var kwhMonth = kw * 24 * MONTH_DAYS * uptime;
        var years5 = [];
        for (var y = 0; y < 5; y++) {
            var ys = { year: y + 1, coins: {}, revenue: 0, elec: 0, profit: 0, halving: [] };
            for (var mm = y * 12; mm < y * 12 + 12; mm++) {
                var r = months[mm];
                ys.revenue += r.revenue; ys.elec += r.elec; ys.profit += r.profit;
                for (var t in r.coins) ys.coins[t] = (ys.coins[t] || 0) + r.coins[t];
                ys.halving = ys.halving.concat(r.halving);
            }
            years5.push(ys);
        }

        return {
            machine: m, qty: opts.qty, invest: invest, kw: kw,
            months: months, years: years5, halvings: halvings,
            roiMonth: roiMonth, startMonth: start,
            monthlyRevenue: first.revenue, monthlyElec: first.elec, monthlyProfit: first.profit,
            monthlyCoins: first.coins,
            maxElecPrice: kwhMonth > 0 ? first.revenue / kwhMonth : 0,
            profit12: sumProfit(months, 12), profit36: sumProfit(months, 36)
        };
    }

    /** Meses (decimales) desde hoy hasta que el equipo está minando, según su entrega */
    function deliveryDelay(m) {
        var d = m.delivery;
        if (!d || d.type === 'ready') return 0;
        if (d.type === 'relative') return d.months || 0;
        if (d.type === 'month' && d.month) {
            var p = d.month.split('-');
            var target = new Date(+p[0], +p[1] - 1, 15);   // mitad del mes de entrega
            return Math.max(0, (target - Date.now()) / (MONTH_DAYS * 86400000));
        }
        return 0;
    }

    function sumProfit(months, n) { var s = 0; for (var i = 0; i < n; i++) s += months[i].profit; return s; }

    function currentOpts(machine, qty, price) {
        return {
            machine: machine, qty: qty, price: price,
            elecPrice: state.elecPrice, freePower: state.freePower,
            poolFee: state.poolFee, uptime: state.uptime,
            priceGrowth: state.priceGrowth, growth: state.growth
        };
    }

    /** Ranking de equipos para un presupuesto (en divisa activa). coin: 'BTC' | 'ZEC' | 'LTC+DOGE' | null */
    function rank(budget, coin) {
        var out = [], list = machines();
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (coin && m.coin !== coin) continue;
            var price = catalogPrice(m);
            var qty = budget ? Math.floor(budget / price) : 1;
            if (qty < 1) continue;
            var r = compute(currentOpts(m, Math.min(qty, 50), price));
            out.push(r);
        }
        out.sort(function(a, b) {
            if (a.roiMonth !== null && b.roiMonth !== null) return a.roiMonth - b.roiMonth;
            if (a.roiMonth !== null) return -1;
            if (b.roiMonth !== null) return 1;
            return b.profit36 - a.profit36;
        });
        return out;
    }

    /**
     * Cálculo sin interfaz (no toca el estado ni localStorage). Para la interfaz guiada.
     * q: { currency, freePower, elecPrice, budget, maxUnitW, maxTotalW, coolings: ['aire'] }
     * Devuelve una oferta por equipo que cabe en presupuesto y potencia, con net36 = beneficio a 36 meses − inversión.
     */
    function quote(q) {
        var saved = state.currency;
        state.currency = q.currency === 'USD' ? 'USD' : 'EUR';
        try {
            var out = [], list = machines();
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (q.coolings && q.coolings.indexOf(m.cooling) < 0) continue;
                if (/usado/i.test(m.name)) continue;
                if (q.maxUnitW && m.powerW > q.maxUnitW) continue;
                var price = catalogPrice(m);
                var qty = q.budget ? Math.floor(q.budget / price) : 1;
                if (q.maxTotalW) qty = Math.min(qty, Math.floor(q.maxTotalW / m.powerW));
                qty = Math.min(qty, 50);
                if (qty < 1) continue;
                var r = compute({
                    machine: m, qty: qty, price: price,
                    elecPrice: q.elecPrice || 0, freePower: !!q.freePower,
                    poolFee: 2, uptime: 97, priceGrowth: 0, growth: state.growth
                });
                r.net36 = r.profit36 - r.invest;
                r.unitPrice = price;
                out.push(r);
            }
            return out;
        } finally {
            state.currency = saved;
        }
    }

    // ─── UI ────────────────────────────────────────────────────────────────

    function build() {
        var scroll = document.querySelector('#sidebar .sidebar-scroll');
        var dash = document.getElementById('dashboard');
        if (!scroll || !dash) return;

        var sw = document.createElement('div');
        sw.className = 'mode-switch';
        sw.innerHTML =
            '<button type="button" data-mode="solar">☀️ Solar</button>' +
            '<button type="button" data-mode="machine">⛏️ Solo máquina</button>';
        scroll.insertBefore(sw, scroll.firstChild);
        sw.addEventListener('click', function(e) {
            var b = e.target.closest('button');
            if (b) setActive(b.getAttribute('data-mode') === 'machine');
        });

        var side = document.createElement('div');
        side.id = 'machine-sidebar';
        side.innerHTML = sidebarHTML();
        scroll.insertBefore(side, sw.nextSibling);

        var main = document.createElement('div');
        main.id = 'machine-dashboard';
        main.innerHTML = dashboardHTML();
        dash.insertBefore(main, dash.firstChild);

        bindInputs();
    }

    function sidebarHTML() {
        var opts = '';
        for (var g in COIN_GROUPS) {
            opts += '<optgroup label="' + COIN_GROUPS[g].label + '">';
            var list = machines();
            for (var i = 0; i < list.length; i++) {
                if (list[i].coin === g) opts += '<option value="' + list[i].id + '">' + esc(displayName(list[i])) + '</option>';
            }
            opts += '</optgroup>';
        }
        return '' +
        '<section class="config-section">' +
            '<h3 class="section-title"><span><span class="section-num">1.</span> Divisa</span></h3>' +
            '<div class="mm-seg" id="mm-currency"><button type="button" data-cur="EUR">€ EUR</button><button type="button" data-cur="USD">$ USD</button></div>' +
        '</section>' +
        '<section class="config-section">' +
            '<h3 class="section-title"><span><span class="section-num">2.</span> Equipo</span></h3>' +
            '<select id="mm-machine" class="select-premium">' + opts + '</select>' +
            '<p class="mm-spec" id="mm-spec"></p>' +
            '<div class="input-row"><label>Cantidad</label><div class="stepper">' +
                '<button type="button" class="stepper-btn" id="mm-qty-dec">−</button>' +
                '<input type="number" id="mm-qty" value="1" min="1" max="500" class="stepper-input">' +
                '<button type="button" class="stepper-btn" id="mm-qty-inc">+</button></div></div>' +
            '<div class="input-row"><label>Precio por equipo</label><div class="input-unit">' +
                '<input type="number" id="mm-price" min="0" step="10" class="input-premium"><span class="unit mm-cur">€</span></div></div>' +
        '</section>' +
        '<section class="config-section">' +
            '<h3 class="section-title"><span><span class="section-num">3.</span> Electricidad</span>' +
                '<label class="toggle-switch" title="Luz gratis"><input type="checkbox" id="mm-free"><span class="toggle-slider"></span></label></h3>' +
            '<p class="section-desc">Activa el interruptor si no pagas la luz.</p>' +
            '<div class="input-row" id="mm-elec-row"><label>Precio de la luz</label><div class="input-unit">' +
                '<input type="number" id="mm-elec" min="0" step="0.005" class="input-premium"><span class="unit"><span class="mm-cur">€</span>/kWh</span></div></div>' +
        '</section>' +
        '<section class="config-section">' +
            '<h3 class="section-title"><span><span class="section-num">4.</span> Supuestos</span></h3>' +
            '<div class="input-row"><label>Dificultad red / año</label><div class="input-unit"><input type="number" id="mm-growth" step="1" class="input-premium"><span class="unit">%</span></div></div>' +
            '<div class="input-row"><label>Precio moneda / año</label><div class="input-unit"><input type="number" id="mm-pgrowth" step="5" class="input-premium"><span class="unit">%</span></div></div>' +
            '<div class="input-row"><label>Comisión pool</label><div class="input-unit"><input type="number" id="mm-fee" min="0" max="10" step="0.5" class="input-premium"><span class="unit">%</span></div></div>' +
            '<div class="input-row"><label>Tiempo activo</label><div class="input-unit"><input type="number" id="mm-uptime" min="50" max="100" step="1" class="input-premium"><span class="unit">%</span></div></div>' +
        '</section>';
    }

    function dashboardHTML() {
        return '' +
        '<div class="results-header"><div class="results-title-wrap"><h2 class="results-title">Rentabilidad del equipo</h2></div>' +
            '<span class="mm-net" id="mm-net"></span></div>' +
        '<div class="kpi-grid" id="mm-kpis"></div>' +
        '<div class="mm-notes" id="mm-notes"></div>' +
        '<div class="chart-card mm-chart-card"><div class="mm-card-title">Beneficio acumulado (60 meses)</div><div class="mm-chart-wrap"><canvas id="mm-chart"></canvas></div></div>' +
        '<div class="mm-card"><div class="mm-card-title">Proyección por año</div><div class="monthly-table-wrap"><table class="monthly-table" id="mm-years"></table></div></div>' +
        '<div class="mm-card"><div class="mm-card-title">Mejores equipos con este presupuesto <span class="mm-muted" id="mm-rank-budget"></span></div>' +
            '<div class="monthly-table-wrap"><table class="monthly-table mm-rank" id="mm-rank"></table></div>' +
            '<p class="mm-muted">Pulsa un equipo para verlo en detalle. Precios de venta de StartMiningNow.es (lista del <span id="mm-list-date"></span>).</p></div>';
    }

    function $(id) { return document.getElementById(id); }

    function bindInputs() {
        $('mm-currency').addEventListener('click', function(e) {
            var b = e.target.closest('button');
            if (!b) return;
            var cur = b.getAttribute('data-cur');
            if (cur === state.currency) return;
            var k = cur === 'EUR' ? net.usdToEur : 1 / net.usdToEur;
            if (state.price !== null) state.price = Math.round(state.price * k);
            state.elecPrice = Math.round(state.elecPrice * k * 1000) / 1000;
            state.currency = cur;
            render();
        });
        $('mm-machine').addEventListener('change', function() {
            state.machineId = this.value;
            state.price = null;
            render();
        });
        $('mm-qty-dec').addEventListener('click', function() { state.qty = Math.max(1, state.qty - 1); render(); });
        $('mm-qty-inc').addEventListener('click', function() { state.qty = Math.min(500, state.qty + 1); render(); });
        onNum('mm-qty', function(v) { state.qty = Math.max(1, Math.round(v)); });
        onNum('mm-price', function(v) { state.price = v; });
        onNum('mm-elec', function(v) { state.elecPrice = v; });
        onNum('mm-growth', function(v) { state.growth[getMachine(state.machineId).coin] = v; });
        onNum('mm-pgrowth', function(v) { state.priceGrowth = v; });
        onNum('mm-fee', function(v) { state.poolFee = v; });
        onNum('mm-uptime', function(v) { state.uptime = Math.min(100, Math.max(1, v)); });
        $('mm-free').addEventListener('change', function() { state.freePower = this.checked; render(); });
        $('mm-rank').addEventListener('click', function(e) {
            var tr = e.target.closest('tr[data-id]');
            if (!tr) return;
            state.machineId = tr.getAttribute('data-id');
            state.qty = parseInt(tr.getAttribute('data-qty'), 10) || 1;
            state.price = null;
            render();
            var d = $('dashboard'); if (d) d.scrollTop = 0;
        });
    }

    var numTimer = null;
    function onNum(id, fn) {
        $(id).addEventListener('input', function() {
            var v = parseFloat(this.value);
            if (isNaN(v)) return;
            fn(v);
            if (numTimer) clearTimeout(numTimer);
            numTimer = setTimeout(function() { render(true); }, 120);
        });
    }

    function syncInputs() {
        var m = getMachine(state.machineId);
        var sym = state.currency === 'EUR' ? '€' : '$';
        var curBtns = $('mm-currency').querySelectorAll('button');
        for (var i = 0; i < curBtns.length; i++) curBtns[i].classList.toggle('active', curBtns[i].getAttribute('data-cur') === state.currency);
        var units = document.querySelectorAll('#machine-sidebar .mm-cur');
        for (var u = 0; u < units.length; u++) units[u].textContent = sym;
        $('mm-machine').value = m.id;
        $('mm-qty').value = state.qty;
        setIfIdle('mm-price', state.price !== null ? state.price : catalogPrice(m));
        setIfIdle('mm-elec', state.elecPrice);
        setIfIdle('mm-growth', state.growth[m.coin]);
        setIfIdle('mm-pgrowth', state.priceGrowth);
        setIfIdle('mm-fee', state.poolFee);
        setIfIdle('mm-uptime', state.uptime);
        $('mm-free').checked = state.freePower;
        $('mm-elec-row').style.display = state.freePower ? 'none' : '';
        $('mm-spec').innerHTML = fmtNum(m.hashrate, m.hashrate < 100 ? 2 : 0) + ' ' + m.unit + ' · ' + fmtNum(m.powerW / 1000, 2) + ' kW · ' +
            fmtNum(m.powerW / m.hashrate, 1) + ' W/' + m.unit.replace('/s', '') +
            (m.delivery ? '<br><b>' + esc(m.delivery.label) + '</b>' : '') +
            (m.note ? '<br><span class="mm-muted">' + esc(m.note) + '</span>' : '');
    }

    function setIfIdle(id, v) { var el = $(id); if (el && document.activeElement !== el) el.value = v; }

    function render(fromInput) {
        if (!$('machine-sidebar')) return;
        if (!fromInput) syncInputs();
        else $('mm-elec-row').style.display = state.freePower ? 'none' : '';
        var m = getMachine(state.machineId);
        var price = state.price !== null ? state.price : catalogPrice(m);
        var r = compute(currentOpts(m, state.qty, price));
        lastResult = r;
        save();

        var sym = state.currency === 'EUR' ? ' €' : ' $';
        var d = net.updatedAt ? new Date(net.updatedAt) : null;
        $('mm-net').textContent = (net.fallback ? 'Datos de red de respaldo' : 'Datos de red en vivo') +
            (d ? ' · ' + d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

        var coinsTxt = [];
        for (var t in r.monthlyCoins) coinsTxt.push(fmtCoin(r.monthlyCoins[t], t) + ' ' + t);

        $('mm-kpis').innerHTML =
            kpi('Producción / mes', coinsTxt.join('<br>'), '≈ ' + fmtInt(r.monthlyRevenue) + sym + ' a precio actual') +
            kpi('Coste luz / mes', state.freePower ? '0' + sym : fmtInt(r.monthlyElec) + sym, state.freePower ? 'Luz gratis' : fmtNum(r.kw * 24 * MONTH_DAYS * state.uptime / 100, 0) + ' kWh') +
            kpi('Beneficio / mes', fmtInt(r.monthlyProfit) + sym, 'Primer año: ' + fmtInt(r.profit12) + sym, r.monthlyProfit > 0 ? 'good' : 'bad') +
            kpi('Amortización', r.roiMonth !== null ? fmtNum(r.roiMonth, 1) + ' meses' : 'No amortiza', 'Inversión: ' + fmtInt(r.invest) + sym, r.roiMonth !== null && r.roiMonth < 24 ? 'good' : '');

        // Notas: halvings y precio máximo de luz
        var notes = [];
        for (var h = 0; h < r.halvings.length; h++) {
            var hv = r.halvings[h];
            notes.push('⚡ <b>Halving de ' + COIN_NAMES[hv.coin] + '</b> estimado en <b>' +
                hv.date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) + '</b> (mes ' + Math.ceil(hv.month) + '): la recompensa se reduce a la mitad.');
        }
        if (r.startMonth > 0.5) notes.push('📦 <b>' + esc(m.delivery.label) + '</b>: empieza a minar hacia el mes ' + Math.ceil(r.startMonth) +
            '. Los meses de espera no producen y retrasan la amortización.');
        if (m.coin === 'LTC+DOGE') notes.push('🐕 Dogecoin no tiene halving. El equipo mina LTC y DOGE a la vez (minado combinado).');
        if (!state.freePower) notes.push('💡 Precio máximo de luz para no perder dinero hoy: <b>' + fmtNum(r.maxElecPrice, 3) + sym.trim() + '/kWh</b>.');
        $('mm-notes').innerHTML = notes.map(function(n) { return '<p>' + n + '</p>'; }).join('');

        renderYears(r, sym);
        renderChart(r);
        renderRank(price * state.qty, m.coin, sym);
        $('mm-list-date').textContent = window.MACHINES_DATA ? new Date(MACHINES_DATA.fecha).toLocaleDateString('es-ES') : '';
    }

    function renderYears(r, sym) {
        var tags = COIN_GROUPS[r.machine.coin].coins;
        var html = '<thead><tr><th>Año</th>';
        for (var i = 0; i < tags.length; i++) html += '<th>' + tags[i] + ' minados</th>';
        html += '<th>Ingresos</th><th>Luz</th><th>Beneficio</th></tr></thead><tbody>';
        var cum = -r.invest;
        for (var y = 0; y < r.years.length; y++) {
            var ys = r.years[y];
            cum += ys.profit;
            html += '<tr><td class="mo-name">Año ' + ys.year + (ys.halving.length ? ' ⚡' : '') + '</td>';
            for (var j = 0; j < tags.length; j++) html += '<td>' + fmtCoin(ys.coins[tags[j]], tags[j]) + '</td>';
            html += '<td>' + fmtInt(ys.revenue) + sym + '</td><td class="mo-cost">' + fmtInt(ys.elec) + sym + '</td>' +
                '<td class="' + (ys.profit >= 0 ? 'mo-good' : 'mo-cost') + '">' + fmtInt(ys.profit) + sym + '</td></tr>';
        }
        html += '</tbody>';
        $('mm-years').innerHTML = html;
    }

    function renderChart(r) {
        if (!window.Chart) return;
        var labels = [], cum = [], inv = [], radius = [];
        for (var i = 0; i < r.months.length; i++) {
            labels.push('M' + r.months[i].month);
            cum.push(Math.round(r.months[i].cum + r.invest));
            inv.push(Math.round(r.invest));
            radius.push(r.months[i].halving.length ? 6 : 0);
        }
        var data = {
            labels: labels,
            datasets: [
                { label: 'Beneficio acumulado', data: cum, borderColor: '#ff8800', backgroundColor: 'rgba(255,136,0,0.12)', fill: true, tension: 0.25, pointRadius: radius, pointBackgroundColor: '#ff5252' },
                { label: 'Inversión', data: inv, borderColor: '#888', borderDash: [6, 4], pointRadius: 0, fill: false }
            ]
        };
        if (chart) { chart.data = data; chart.update('none'); return; }
        chart = new Chart($('mm-chart'), {
            type: 'line', data: data,
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { boxWidth: 12 } } },
                scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: function(v) { return fmtInt(v); } } } }
            }
        });
    }

    function renderRank(budget, coin, sym) {
        var list = rank(budget, null).slice(0, 8);
        $('mm-rank-budget').textContent = '(' + fmtInt(budget) + sym + ')';
        var html = '<thead><tr><th>Equipo</th><th>Uds.</th><th>Moneda</th><th>Beneficio/mes</th><th>Amortiza</th></tr></thead><tbody>';
        for (var i = 0; i < list.length; i++) {
            var r = list[i];
            var cur = r.machine.id === state.machineId && r.qty === state.qty;
            html += '<tr data-id="' + r.machine.id + '" data-qty="' + r.qty + '"' + (cur ? ' class="mm-current"' : '') + '>' +
                '<td class="mo-name">' + esc(displayName(r.machine)) + '</td><td>' + r.qty + '</td><td>' + r.machine.coin + '</td>' +
                '<td class="' + (r.monthlyProfit >= 0 ? 'mo-good' : 'mo-cost') + '">' + fmtInt(r.monthlyProfit) + sym + '</td>' +
                '<td>' + (r.roiMonth !== null ? fmtNum(r.roiMonth, 1) + ' m' : '—') + '</td></tr>';
        }
        if (!list.length) html += '<tr><td colspan="5" class="mm-muted">Ningún equipo cabe en este presupuesto.</td></tr>';
        $('mm-rank').innerHTML = html + '</tbody>';
    }

    function kpi(label, value, sub, cls) {
        return '<div class="kpi-card' + (cls ? ' mm-' + cls : '') + '"><div class="kpi-label">' + label + '</div>' +
            '<div class="kpi-value mm-kpi-value">' + value + '</div><div class="kpi-subvalue">' + sub + '</div></div>';
    }

    // ─── Modo ──────────────────────────────────────────────────────────────

    function setActive(on) {
        active = !!on;
        var app = $('app');
        if (app) app.classList.toggle('mode-machine', active);
        var btns = document.querySelectorAll('.mode-switch button');
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', (btns[i].getAttribute('data-mode') === 'machine') === active);
        if (active) render();
        save();
    }

    function save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ active: active, state: state })); } catch (e) {}
    }
    function restore() {
        try {
            var d = JSON.parse(localStorage.getItem(STORE_KEY));
            if (d && d.state) {
                for (var k in d.state) if (state.hasOwnProperty(k)) state[k] = d.state[k];
                if (!getMachine(state.machineId) || getMachine(state.machineId).id !== state.machineId) state.machineId = machines()[0].id;
            }
            return d ? d.active : false;
        } catch (e) { return false; }
    }

    // ─── Informe y CSV ─────────────────────────────────────────────────────

    function openReport() {
        var r = lastResult;
        if (!r) return;
        var sym = state.currency === 'EUR' ? ' €' : ' $';
        var w = window.open('', '_blank');
        if (!w) return;
        var tags = COIN_GROUPS[r.machine.coin].coins;
        var rows = '';
        for (var y = 0; y < r.years.length; y++) {
            var ys = r.years[y];
            rows += '<tr><td>Año ' + ys.year + (ys.halving.length ? ' ⚡ halving' : '') + '</td>';
            for (var j = 0; j < tags.length; j++) rows += '<td>' + fmtCoin(ys.coins[tags[j]], tags[j]) + ' ' + tags[j] + '</td>';
            rows += '<td>' + fmtInt(ys.revenue) + sym + '</td><td>' + fmtInt(ys.elec) + sym + '</td><td><b>' + fmtInt(ys.profit) + sym + '</b></td></tr>';
        }
        var halv = r.halvings.map(function(h) {
            return '<li>Halving de ' + COIN_NAMES[h.coin] + ': ' + h.date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) + '</li>';
        }).join('');
        var coinsTxt = [];
        for (var t in r.monthlyCoins) coinsTxt.push(fmtCoin(r.monthlyCoins[t], t) + ' ' + t);
        var prices = tags.map(function(t) { return t + ': ' + fmtPrice(coinPrice(t)) + sym; }).join(' · ');
        var today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

        var html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de rentabilidad — ' + esc(r.machine.name) + '</title>' +
            '<style>body{font-family:Inter,Arial,sans-serif;color:#1a1a2e;max-width:820px;margin:32px auto;padding:0 20px}h1{font-size:22px;margin:0}' +
            '.sub{color:#666;margin:4px 0 24px}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.k div{background:#f5f5f8;border-radius:10px;padding:12px}' +
            '.k span{display:block;font-size:11px;color:#666}.k b{font-size:17px;color:#cc6600}table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}' +
            'th,td{text-align:right;padding:7px 8px;border-bottom:1px solid #eee}th:first-child,td:first-child{text-align:left}th{background:#fafafa}' +
            'h2{font-size:15px;margin:26px 0 6px}.n{font-size:12px;color:#555;line-height:1.6}.foot{margin-top:30px;padding-top:14px;border-top:2px solid #ff8800;font-size:12px}' +
            '@media print{button{display:none}}</style></head><body>' +
            '<button onclick="print()" style="float:right;padding:8px 14px;background:#ff8800;border:0;border-radius:8px;font-weight:700;cursor:pointer">Imprimir / PDF</button>' +
            '<h1>Informe de rentabilidad de minería</h1><p class="sub">' + today + ' · SolHash Pro · StartMiningNow.es</p>' +
            '<h2>Configuración</h2><table><tr><td>Equipo</td><td>' + r.qty + '× ' + esc(r.machine.name) + '</td></tr>' +
            '<tr><td>Potencia total</td><td>' + fmtNum(r.kw, 2) + ' kW</td></tr>' +
            '<tr><td>Electricidad</td><td>' + (state.freePower ? 'Gratis' : fmtNum(state.elecPrice, 3) + sym.trim() + '/kWh') + '</td></tr>' +
            '<tr><td>Inversión en equipos</td><td>' + fmtInt(r.invest) + sym + '</td></tr>' +
            '<tr><td>Precio actual</td><td>' + prices + '</td></tr></table>' +
            '<div class="k"><div><span>Producción / mes</span><b>' + coinsTxt.join('<br>') + '</b></div><div><span>Beneficio / mes</span><b>' + fmtInt(r.monthlyProfit) + sym + '</b></div>' +
            '<div><span>Beneficio 1er año</span><b>' + fmtInt(r.profit12) + sym + '</b></div><div><span>Amortización</span><b>' + (r.roiMonth !== null ? fmtNum(r.roiMonth, 1) + ' meses' : 'No amortiza') + '</b></div></div>' +
            '<h2>Proyección a 5 años</h2><table><tr><th>Periodo</th>' + tags.map(function(t) { return '<th>' + t + '</th>'; }).join('') + '<th>Ingresos</th><th>Luz</th><th>Beneficio</th></tr>' + rows + '</table>' +
            (halv ? '<h2>Halvings previstos</h2><ul class="n">' + halv + '</ul>' : '') +
            '<h2>Supuestos</h2><p class="n">Dificultad de red +' + state.growth[r.machine.coin] + '%/año · precio de la moneda ' + (state.priceGrowth >= 0 ? '+' : '') + state.priceGrowth + '%/año · ' +
            'comisión de pool ' + state.poolFee + '% · tiempo activo ' + state.uptime + '%. Datos de red ' + (net.fallback ? 'de respaldo' : 'en vivo') + ' (WhatToMine, CoinGecko). ' +
            'Estimación orientativa: la rentabilidad real depende del precio de la moneda, la dificultad y las condiciones de operación.</p>' +
            '<div class="foot"><b>Marcos · StartMiningNow.es</b> — Venta de equipos y asesoría en minería · WhatsApp +34 623 056 949 · www.startminingnow.es</div>' +
            '</body></html>';
        w.document.open(); w.document.write(html); w.document.close();
    }

    function exportCSV() {
        var r = lastResult;
        if (!r) return;
        var tags = COIN_GROUPS[r.machine.coin].coins;
        var lines = ['Mes;' + tags.join(';') + ';Ingresos;Luz;Beneficio;Acumulado'];
        for (var i = 0; i < r.months.length; i++) {
            var m = r.months[i];
            lines.push([m.month].concat(tags.map(function(t) { return String(m.coins[t]).replace('.', ','); }),
                [m.revenue, m.elec, m.profit, m.cum].map(function(v) { return v.toFixed(2).replace('.', ','); })).join(';'));
        }
        var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'solhash-' + r.machine.id + '.csv';
        a.click();
    }

    // ─── Formato ───────────────────────────────────────────────────────────

    // es-ES no agrupa miles en números de 4 cifras; se agrupa a mano para que "2.748" se lea igual que "12.748"
    function fmtNum(n, d) {
        var s = Math.abs(n || 0).toFixed(d).split('.');
        var int = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return ((n || 0) < 0 && Number(s.join('.')) !== 0 ? '-' : '') + int + (d > 0 ? ',' + s[1] : '');
    }
    function fmtInt(n) { return fmtNum(Math.round(n || 0), 0); }
    function fmtCoin(n, tag) {
        n = n || 0;
        if (tag === 'DOGE') return fmtNum(n, 0);
        if (tag === 'LTC' || tag === 'ZEC') return fmtNum(n, 3);
        return fmtNum(n, 5);
    }
    function fmtPrice(n) { return n < 1 ? fmtNum(n, 4) : fmtInt(n); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ─── Init ──────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', function() {
        if (!machines().length) return;
        build();
        var wasActive = restore();
        if (getMachine(state.machineId).id !== state.machineId) state.machineId = machines()[0].id;
        setActive(wasActive);
        loadNetwork();

        // Informe y CSV de la barra superior actúan sobre el modo activo
        var origReport = window.generarInforme, origCSV = window.exportCSV;
        window.generarInforme = function() { if (active) openReport(); else if (origReport) origReport.apply(this, arguments); };
        window.exportCSV = function() { if (active) exportCSV(); else if (origCSV) origCSV.apply(this, arguments); };
    });

    return {
        isActive: function() { return active; },
        activate: function() { setActive(true); },
        deactivate: function() { setActive(false); },
        /** Aplica una configuración (p.ej. desde el analizador de leads) y recalcula */
        apply: function(cfg) {
            for (var k in cfg) if (state.hasOwnProperty(k)) state[k] = cfg[k];
            setActive(true);
            render();
            return lastResult;
        },
        getResult: function() { return lastResult; },
        getState: function() { return JSON.parse(JSON.stringify(state)); },
        rank: rank,
        quote: quote,
        onNetwork: function(cb) { netListeners.push(cb); },
        networkInfo: function() { return { live: !net.fallback, updatedAt: net.updatedAt }; },
        machines: machines,
        getMachine: getMachine,
        displayName: displayName,
        catalogPrice: catalogPrice,
        usdToEur: function() { return net.usdToEur; },
        coinNames: COIN_NAMES
    };
})();
