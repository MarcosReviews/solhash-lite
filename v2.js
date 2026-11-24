/**
 * SolHash Pro V2 — interfaz guiada sobre el mismo motor de la Pro (js/engine.js).
 * Aquí solo hay interfaz: el estado del asistente se traduce a los mismos `inputs`
 * que usa la Pro clásica y se calcula con SolHash.calculate / compareMiningVsHodl.
 */
(function() {
    'use strict';

    var WORKER = 'https://solhash-license.reviewsmarcos.workers.dev';
    var WHATSAPP = '34623056949';
    // SolHash Lite (gratis y sin licencia, generada con tools/build-lite.js): mismo cálculo,
    // pero leer la factura, el informe en PDF y los ajustes finos quedan para la Pro
    var LITE = !!window.SOLHASH_LITE;
    var PRO_URL = 'https://www.startminingnow.es/solhash';
    var STORE = 'solhash_v2_state';
    var ORDER = ['situacion', 'presupuesto', 'ubicacion', 'luz', 'maquinas', 'resultado'];
    var TARIFFS = {
        '2.0td':   { punta: 0.22, llano: 0.14, valle: 0.05, label: 'Tarifa 2.0TD' },
        'octopus': { punta: 0.16, llano: 0.12, valle: 0.04, label: 'Noches baratas' },
        'gratis':  { punta: 0, llano: 0, valle: 0, label: 'Luz gratis' }
    };
    // Factor sobre las horas de sol por defecto del motor (zona centro-sur)
    var ZONES = {
        norte:    { f: 0.72, label: 'Norte de España' },
        centro:   { f: 0.93, label: 'Centro de España' },
        sur:      { f: 1.00, label: 'Sur y Levante' },
        canarias: { f: 1.00, label: 'Canarias' }
    };
    var SITUATIONS = { casa: 'Placas en casa', dedicada: 'Instalación para minar', nueva: 'Placas nuevas', red: 'Sin placas' };
    var MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    var BUDGET_LABELS = {
        'bud-miners': 'Máquinas', 'bud-panels': 'Paneles', 'bud-inverter': 'Inversor', 'bud-mounting': 'Estructura',
        'bud-cabling': 'Cableado y protecciones', 'bud-labor': 'Mano de obra', 'bud-permits': 'Permisos', 'bud-battery': 'Batería'
    };

    var DEFAULTS = {
        step: 'situacion', reached: 0,
        situacion: null,
        casaKwp: 6, casaConsumo: 10, casaBateria: 0, estrategia: 'surplus-only',
        existKwp: 10, existKwh: 0, existCost: 0, addKwp: 0, addKwh: 0,
        newKwp: 10, newKwh: 0, solarMode: 'auto', roof: 'tejado', installer: true,
        presupuesto: null,
        lugar: '', hsp: null, zona: null, lat: null, lon: null, hspEstimated: false,
        tarifa: '2.0td', fijo: 0.12, punta: 0.22, llano: 0.14, valle: 0.05, excedentes: 0.02,
        minerKey: null, qty: 1, minerManual: false, cHash: 200, cPower: 3, cPrice: 3000,
        mant: null, dod: 80, btcTarget: null, budget: {}, bill: null, billApplied: false, moneda: 'EUR'
    };

    var st = load();
    var lastCalc = null;

    // ─── Estado ────────────────────────────────────────────────────────────

    function load() {
        var s = JSON.parse(JSON.stringify(DEFAULTS));
        try {
            var saved = JSON.parse(localStorage.getItem(STORE));
            if (saved) for (var k in saved) if (s.hasOwnProperty(k)) s[k] = saved[k];
        } catch (e) {}
        return s;
    }
    function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) {} }
    function $(id) { return document.getElementById(id); }
    function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    // ─── Del asistente a los inputs del motor ──────────────────────────────

    function tariff() {
        if (st.tarifa === 'fijo') return { punta: st.fijo, llano: st.fijo, valle: st.fijo };
        return { punta: st.punta, llano: st.llano, valle: st.valle };
    }

    function minerFor(key) {
        if (key === 'custom') {
            return { name: 'Tu equipo', hashrate: st.cHash, powerKW: st.cPower, efficiency: st.cHash > 0 ? st.cPower * 1000 / st.cHash : 0, noise: 75, price: st.cPrice, cooling: 'aire', ready: true };
        }
        return SolHash.MINERS[key];
    }

    /** Mantenimiento por máquina y año: no se descuenta (solo la luz), salvo que el usuario ponga una cifra en Ajustes finos */
    function mantFor() { return st.mant > 0 ? st.mant : 0; }

    function buildInputs(o) {
        o = o || {};
        var key = o.minerKey || st.minerKey;
        var qty = o.qty || st.qty;
        var t = tariff(), sit = st.situacion;
        var newKwp = o.newKwp !== undefined ? o.newKwp : st.newKwp;
        var newKwh = o.newKwh !== undefined ? o.newKwh : st.newKwh;
        var strat = o.estrategia || st.estrategia;
        var budget = {};
        for (var b in st.budget) {
            if (o.ignoreMinerBudget && b === 'bud-miners') continue;
            if (sit === 'nueva' && b !== 'bud-miners') continue;    // la instalación nueva sale de la lista de materiales
            budget[b] = st.budget[b];
        }
        if (sit === 'nueva') {
            var d = designSolar(newKwp, newKwh);
            if (d) { for (var bk in d.budget) budget[bk] = d.budget[bk]; newKwp = d.kwp; newKwh = d.kwh; }
        }
        return {
            miner: minerFor(key), minerKey: key, qty: qty,
            solarKWp: sit === 'nueva' ? newKwp : sit === 'dedicada' ? st.addKwp : 0,
            batteryOn: (sit === 'nueva' && newKwh > 0) || (sit === 'dedicada' && st.addKwh > 0),
            batteryKWh: sit === 'nueva' ? newKwh : sit === 'dedicada' ? st.addKwh : 0,
            batteryDoD: st.dod / 100,
            punta: t.punta, llano: t.llano, valle: t.valle,
            btcProjection: st.btcTarget || SolHash.BTC_PRICE,
            maintenancePerAsic: mantFor(),
            precioExcedentes: st.excedentes,
            hasExisting: sit === 'dedicada', existingKwp: st.existKwp, existingKwh: st.existKwh, existingCost: st.existCost,
            surplusMode: sit === 'casa', surplusTotalKwp: st.casaKwp, householdKWhDay: st.casaConsumo,
            surplusBatteryKWh: st.casaBateria, surplusStrategy: sit === 'red' ? '24h' : strat,
            budget: budget
        };
    }

    function applyHSP() {
        if (st.hsp && st.hsp.length === 12) SolHash.setHSP(st.hsp);
        else {
            var f = (ZONES[st.zona] || ZONES.centro).f;
            SolHash.setHSP(SolHash.DEFAULT_HSP.map(function(v) { return Math.round(v * f * 100) / 100; }));
        }
    }

    /** Cálculo completo + métricas derivadas que usa la V2 */
    function calc(o) {
        var inputs = buildInputs(o);
        if (!inputs.miner) return null;
        var r = SolHash.calculate(inputs);
        var price = SolHash.BTC_PRICE;
        var opexMonth = (r.gridCostYear + r.maintenanceYear) / 12;

        // Beneficio mes a mes con la dificultad creciendo y los halvings en su fecha.
        // Si un mes la máquina gasta más de lo que genera, se supone que la apagas (beneficio 0),
        // como haría cualquier minero: el motor de la Pro clásica la deja encendida perdiendo dinero.
        var raw = [];
        for (var m = 0; m < 60; m++) raw.push(r.proyeccion60m[m].btc * price - opexMonth);
        for (var y = 5; y < 10; y++) {
            var yp = (r.roiProjection[y] - r.roiProjection[y - 1]) / 12;
            for (var k = 0; k < 12; k++) raw.push(yp);
        }
        var monthly = raw.map(function(v) { return Math.max(0, v); });
        var offMonth = null;
        for (var o2 = 0; o2 < raw.length; o2++) if (raw[o2] < 0) { offMonth = o2 + 1; break; }
        var inv = r.totalInvestment, cum = -inv, payback = null, acc = [-inv];
        for (var i = 0; i < monthly.length; i++) {
            var prev = cum;
            cum += monthly[i];
            if (payback === null && cum >= 0 && monthly[i] > 0) payback = i + (-prev / monthly[i]);
            if ((i + 1) % 12 === 0) acc.push(cum);
        }
        var btc1 = 0, btc5 = 0, onMonths = 0;
        for (var j = 0; j < 60; j++) {
            if (j < 12) btc1 += r.proyeccion60m[j].btc;
            if (raw[j] < 0) continue;            // apagada: ni mina ni gasta
            btc5 += r.proyeccion60m[j].btc;
            onMonths++;
        }
        var sum5 = monthly.slice(0, 60).reduce(function(a, b) { return a + b; }, 0);
        return {
            inputs: inputs, r: r, price: price, payback: payback, btc1: btc1, btc5: btc5,
            year1: raw.slice(0, 12).reduce(function(a, b) { return a + b; }, 0),
            rev1: btc1 * price, net5: sum5 - inv, recov5: inv > 0 ? sum5 / inv : 0,
            offMonth: offMonth, acc: acc, opex5: opexMonth * onMonths
        };
    }

    // ─── Recomendaciones de máquinas ───────────────────────────────────────

    /** Mejor primero: lo que más deja en 5 años; entre opciones que no recuperan la inversión, la que más recupera */
    function better(a, b) {
        var ta = a.net5 >= 0 ? 1 : 0, tb = b.net5 >= 0 ? 1 : 0;
        if (ta !== tb) return tb - ta;
        return ta ? b.net5 - a.net5 : b.recov5 - a.recov5;
    }

    function solarPeakKW() {
        if (st.situacion === 'casa') return Math.max(0, st.casaKwp * 0.75 - st.casaConsumo / 24);
        if (st.situacion === 'dedicada') return (st.existKwp + st.addKwp) * 0.8;
        if (st.situacion === 'nueva') return st.newKwp * 0.8;
        return 0;
    }

    /** Presupuesto para máquinas (null = sin tope) */
    function machinesBudget() { return st.presupuesto > 0 ? st.presupuesto : null; }

    function recommend(cap) {
        applyHSP();
        if (cap === undefined) cap = machinesBudget();
        var M = SolHash.MINERS, peak = solarPeakKW(), best = [];
        Object.keys(M).forEach(function(key) {
            var m = M[key];
            if (key === 'custom' || !m.ready || m.cooling !== 'aire') return;
            var maxQ = peak > 0 ? Math.max(1, Math.min(12, Math.ceil(peak / m.powerKW) + (st.situacion === 'casa' ? 0 : 1))) : 1;
            if (st.situacion === 'red') maxQ = cap ? Math.min(10, Math.floor(cap / m.price)) : 1;
            else if (cap) maxQ = Math.min(maxQ, Math.floor(cap / m.price));
            if (maxQ < 1) return;
            var top = null;
            for (var q = 1; q <= maxQ; q++) {
                var c = calc({ minerKey: key, qty: q, ignoreMinerBudget: true });
                if (c && (!top || better(c, top) < 0)) top = c;
            }
            if (top) best.push(top);
        });
        best.sort(better);
        // Modelos distintos (la lista tiene variantes de hashrate del mismo equipo)
        var out = [], seen = {};
        for (var i = 0; i < best.length && out.length < 3; i++) {
            var fam = best[i].inputs.miner.name.replace(/\s[\d,.]+\s?TH\/s.*$/, '');
            if (seen[fam]) continue;
            seen[fam] = true;
            out.push(best[i]);
        }
        return out;
    }

    // ─── Instalación solar nueva: materiales y diseño ──────────────────────

    /** Lista de materiales para kWp y kWh dados (precios de js/solar-materials.js, sin IVA) */
    function designSolar(kwp, kwh) {
        var M = window.SOLAR_MATERIALS;
        if (!M || !(kwp > 0)) return null;
        var n = Math.max(2, Math.round(kwp * 1000 / M.panel.w));
        var realKwp = Math.round(n * M.panel.w / 10) / 100;
        var inv = M.inverters.filter(function(i) { return i.kw * M.maxDcAcRatio >= realKwp; })[0] || M.inverters[M.inverters.length - 1];
        var mods = kwh > 0 ? Math.max(1, Math.round(kwh / M.battery.kwh)) : 0;
        var roof = M.structure[st.roof] || M.structure.tejado;
        var items = [
            { k: 'bud-panels', n: n, label: M.panel.name, unit: M.panel.price },
            { k: 'bud-inverter', n: 1, label: 'Inversor híbrido de ' + num(inv.kw, inv.kw % 1 ? 1 : 0) + ' kW, ' + (inv.tri ? 'trifásico' : 'monofásico'), unit: inv.price },
            { k: 'bud-mounting', n: 1, label: roof.label + ' (' + n + ' paneles)', unit: roof.perPanel * n }
        ];
        if (roof.foundationPerPanel) items.push({ k: 'bud-mounting', n: 1, label: 'Cimentación: zapatas de hormigón', unit: roof.foundationPerPanel * n });
        items.push({ k: 'bud-cabling', n: 1, label: M.electrical.label, unit: M.electrical.base + M.electrical.perPanel * n });
        if (mods) items.push({ k: 'bud-battery', n: mods, label: M.battery.name, unit: M.battery.price });
        if (st.installer) items.push({ k: 'bud-labor', n: 1, label: M.labor.label, unit: Math.max(M.labor.min, Math.round(M.labor.perKwp * realKwp / 10) * 10) });
        items.push({ k: 'bud-permits', n: 1, label: M.permits.label, unit: M.permits.price });
        var budget = { 'bud-panels': 0, 'bud-inverter': 0, 'bud-mounting': 0, 'bud-cabling': 0, 'bud-labor': 0, 'bud-permits': 0, 'bud-battery': 0 };
        var total = 0;
        items.forEach(function(it) { it.total = it.n * it.unit; budget[it.k] += it.total; total += it.total; });
        return { panels: n, kwp: realKwp, inverter: inv, modules: mods, kwh: Math.round(mods * M.battery.kwh * 100) / 100, items: items, budget: budget, total: total, area: n * M.panel.areaM2 };
    }

    function family(name) { return name.replace(/\s[\d,.]+\s?TH\/s.*$/, ''); }

    /** Busca, dentro del presupuesto, la combinación de placas, batería y máquinas que más deja en 5 años */
    function designProject() {
        applyHSP();
        var B = st.presupuesto > 0 ? st.presupuesto : 10000;
        var M = SolHash.MINERS, mods = [0, 1, 2, 3], ratios = [1, 1.5, 2, 3];
        var keys = Object.keys(M).filter(function(k) { return k !== 'custom' && M[k].ready && M[k].cooling === 'aire' && M[k].powerKW >= 1; });
        var byEff = keys.slice().sort(function(a, b) { return M[a].efficiency - M[b].efficiency; }).slice(0, 6);
        var byCost = keys.slice().sort(function(a, b) { return M[a].price / M[a].hashrate - M[b].price / M[b].hashrate; }).slice(0, 5);
        var cand = byEff.concat(byCost.filter(function(k) { return byEff.indexOf(k) < 0; }));
        var all = [];
        cand.forEach(function(key) {
            var m = M[key];
            for (var q = 1; q <= 8 && m.price * q < B; q++) {
                ratios.forEach(function(ratio) {
                    mods.forEach(function(md) {
                        var d = designSolar(ratio * m.powerKW * q, md * SOLAR_MATERIALS.battery.kwh);
                        if (!d || d.total + m.price * q > B) return;
                        ['surplus-only', '24h'].forEach(function(strat) {
                            var c = calc({ minerKey: key, qty: q, newKwp: d.kwp, newKwh: d.kwh, estrategia: strat, ignoreMinerBudget: true });
                            if (c) { c.design = d; c.strat = strat; all.push(c); }
                        });
                    });
                });
            }
        });
        all.sort(better);
        var out = [], seen = {};
        for (var i = 0; i < all.length && out.length < 3; i++) {
            var f = family(all[i].inputs.miner.name);
            if (seen[f]) continue;
            seen[f] = true;
            out.push(all[i]);
        }
        return out;
    }

    // ─── Guía de precios y ganancias (paso de presupuesto) ────────────────

    function quickInputs(key, p) {
        var m = SolHash.MINERS[key];
        return {
            miner: m, minerKey: key, qty: 1, solarKWp: 0, batteryOn: false, batteryKWh: 0, batteryDoD: 0.8,
            punta: p, llano: p, valle: p, btcProjection: SolHash.BTC_PRICE, maintenancePerAsic: 0, precioExcedentes: 0,
            hasExisting: false, existingKwp: 0, existingKwh: 0, existingCost: 0,
            surplusMode: false, surplusTotalKwp: 0, householdKWhDay: 0, surplusBatteryKWh: 0, surplusStrategy: '24h', budget: {}
        };
    }
    /** Lo que deja una máquina al mes, hoy, con la luz a p €/kWh (ya descontada la luz) */
    function monthProfit(key, p) {
        var r = SolHash.calculate(quickInputs(key, p));
        return (r.yearlyBTCeur - r.gridCostYear) / 12;
    }
    function guidePicks() {
        var M = SolHash.MINERS;
        var keys = Object.keys(M).filter(function(k) { return k !== 'custom' && M[k].ready && M[k].cooling === 'aire' && M[k].powerKW >= 1; });
        if (!keys.length) return [];
        var cheap = keys.slice().sort(function(a, b) { return M[a].price - M[b].price; })[0];
        var rest = keys.filter(function(k) { return family(M[k].name) !== family(M[cheap].name); });
        var score = {};
        rest.forEach(function(k) { score[k] = monthProfit(k, 0.08) / M[k].price; });
        var value = rest.slice().sort(function(a, b) { return score[b] - score[a]; })[0];
        var eff = rest.filter(function(k) { return !value || family(M[k].name) !== family(M[value].name); })
            .sort(function(a, b) { return M[a].efficiency - M[b].efficiency; })[0];
        return [[cheap, 'Para empezar'], [value, 'La que más rinde por euro'], [eff, 'La más eficiente']].filter(function(x) { return x[0]; });
    }
    function renderGuide() {
        var M = SolHash.MINERS, picks = guidePicks();
        if (!picks.length) { $('guide').innerHTML = ''; return; }
        var levels = [[0, 'Con tu sol o luz gratis'], [0.08, 'Luz barata (' + kwh(0.08, 2) + ')'], [0.15, 'Luz normal (' + kwh(0.15, 2) + ')']];
        $('guide').innerHTML = '<h2 id="guide-title">Para que te hagas una idea</h2>' +
            '<p class="what">Lo que cuesta una máquina de minar Bitcoin y lo que deja al mes según lo que pagues la luz. Con los precios de hoy y ya descontada la luz.</p>' +
            '<div class="guide-grid">' + picks.map(function(p) {
                var m = M[p[0]];
                return '<article class="g-card"><span class="tag">' + p[1] + '</span><b>' + esc(m.name) + '</b>' +
                    '<span class="g-price">' + eur(m.price) + '<small> · consume ' + num(m.powerKW, 1) + ' kW</small></span>' +
                    levels.map(function(l) {
                        var v = monthProfit(p[0], l[0]);
                        return '<span class="kv">' + l[1] + '<strong class="' + (v < 0 ? 'bad' : 'good') + '">' + signed(v) + '/mes</strong></span>';
                    }).join('') + '</article>';
            }).join('') + '</div>' +
            '<p class="help">Con la luz normal de casa casi nunca compensa: lo que hace rentable minar es la luz barata o tu propio sol. Y cada año la máquina genera algo menos, porque la red de Bitcoin se vuelve más exigente.</p>';
    }

    var BUDGETS = { nueva: [5000, 8000, 12000, 20000, 30000], otros: [1000, 2000, 5000, 10000, 20000] };
    function renderBudget() {
        var auto = st.situacion === 'nueva' && st.solarMode !== 'manual';
        $('budget-lead').textContent = auto
            ? 'Todo incluido: placas, inversor, batería si compensa, montaje y máquinas. Con esa cifra diseño la instalación que más rinde.'
            : st.situacion === 'nueva' ? 'Lo que quieres gastar en máquinas de minar, aparte de las placas.'
            : 'Lo que quieres gastar en máquinas de minar. Con eso te digo cuáles y cuántas te convienen.';
        var opts = auto ? BUDGETS.nueva : BUDGETS.otros;   // cifras redondas en la moneda elegida
        var cur = st.presupuesto > 0 ? Math.round(toCur(st.presupuesto)) : null;
        $('budget-chips').innerHTML = opts.map(function(v) {
            return '<button type="button" data-val="' + v + '"' + (cur !== null && Math.abs(cur - v) < 1 ? ' class="sel"' : '') + '>' + num(v) + '\u00a0' + sym() + '</button>';
        }).join('') + '<button type="button" data-val="-1"' + (st.presupuesto === -1 ? ' class="sel"' : '') + '>No lo sé<small>Enséñame opciones</small></button>';
        $('b-otro').value = cur !== null && opts.indexOf(cur) < 0 ? cur : '';
        renderGuide();
    }
    function setBudget(v) {   // v en la moneda elegida (o -1 = no lo sé)
        st.presupuesto = v > 0 ? fromCur(v) : v;
        st.minerManual = false;   // otro presupuesto: vuelve a recomendar
        save();
        qsa('#budget-chips button').forEach(function(b) { b.classList.toggle('sel', parseFloat(b.getAttribute('data-val')) === v); });
        syncNav();
    }

    // ─── Formato ───────────────────────────────────────────────────────────

    function num(n, d) {
        d = d || 0;
        var neg = n < 0, s = Math.abs(n || 0).toFixed(d).split('.');
        var int = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        var out = int + (d > 0 ? ',' + s[1] : '');
        return (neg && Number(s.join('.')) !== 0 ? '−' : '') + out;
    }
    // Moneda: el motor calcula en euros; aquí solo se convierte lo que se enseña y lo que se escribe.
    var usdPerEur = 1.10;                       // se actualiza con los datos en vivo
    function rate() { return st.moneda === 'USD' ? usdPerEur : 1; }
    function toCur(v) { return v * rate(); }
    function fromCur(v) { return v / rate(); }
    function sym() { return st.moneda === 'USD' ? '$' : '€'; }
    function eur(n) { return num(Math.round(toCur(n))) + '\u00a0' + sym(); }
    function kwh(p, d) { return num(toCur(p), d === undefined ? 3 : d) + '\u00a0' + sym() + '/kWh'; }
    /** Dinero con céntimos para cantidades pequeñas (lo que se gana en un día) */
    function eurFine(n) { var v = toCur(n); return num(v, Math.abs(v) < 100 ? 2 : 0) + ' ' + sym(); }
    function btcFine(n) { return num(n, n < 0.001 ? 6 : n < 0.1 ? 5 : 4); }
    function signed(n) { return (n > 0.5 ? '+' : '') + eur(n); }
    function months(m) {
        if (m === null || m === undefined) return 'más de 10 años';
        var n = Math.max(1, Math.ceil(m));
        return n < 24 ? n + (n === 1 ? ' mes' : ' meses') : num(m / 12, 1) + ' años';
    }
    function btc(n) { return num(n, n < 0.1 ? 4 : 3); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ─── Navegación ────────────────────────────────────────────────────────

    function stepValid(step) {
        if (step === 'situacion') return !!st.situacion;
        if (step === 'presupuesto') return st.presupuesto !== null && st.presupuesto !== undefined;
        if (step === 'ubicacion') return st.situacion === 'red' || !!(st.hsp || st.zona);
        if (step === 'luz') return !!st.tarifa;
        if (step === 'maquinas') return !!minerFor(st.minerKey) && st.qty >= 1;
        return true;
    }
    function hint(step) {
        return {
            situacion: 'Elige una opción para continuar',
            presupuesto: 'Elige cuánto quieres invertir',
            ubicacion: 'Busca tu municipio o elige una zona',
            maquinas: 'Elige una máquina'
        }[step] || '';
    }

    function go(step) {
        var idx = ORDER.indexOf(step);
        if (idx < 0) return;
        for (var i = 0; i < idx; i++) if (!stepValid(ORDER[i])) { step = ORDER[i]; idx = i; break; }
        st.step = step;
        st.reached = Math.max(st.reached, idx);
        save();
        qsa('.step').forEach(function(s) { s.classList.toggle('active', s.getAttribute('data-step') === step); });
        qsa('#steps button').forEach(function(b, i) {
            b.classList.toggle('current', i === idx);
            b.classList.toggle('done', i < idx || (i <= st.reached && i !== idx));
            b.disabled = i > st.reached;
        });
        $('app').classList.toggle('on-result', step === 'resultado');
        $('prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
        $('next').textContent = idx === ORDER.length - 2 ? 'Ver mi resultado' : 'Continuar';
        if (step === 'ubicacion' && st.situacion === 'red') { go(ORDER.indexOf(st._from || 'presupuesto') > idx ? 'presupuesto' : 'luz'); return; }
        if (step === 'presupuesto') renderBudget();
        if (step === 'maquinas') renderMachines();
        if (step === 'ubicacion') setTimeout(function() { initMap(); if (map) map.invalidateSize(); }, 30);
        if (step === 'resultado') renderResult();
        syncNav();
        window.scrollTo(0, 0);
    }
    function syncNav() {
        var ok = stepValid(st.step);
        $('next').disabled = !ok;
        $('nav-hint').textContent = ok ? '' : hint(st.step);
    }

    // ─── Controles del asistente ───────────────────────────────────────────

    function syncControls() {
        qsa('.tile[data-set]').forEach(function(t) {
            var on = st[t.getAttribute('data-set')] === t.getAttribute('data-val');
            t.classList.toggle('sel', on);
            t.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        qsa('.detail[data-for]').forEach(function(d) { d.classList.toggle('show', d.getAttribute('data-for') === st.situacion); });
        qsa('.detail[data-for-tarifa]').forEach(function(d) { d.classList.toggle('show', d.getAttribute('data-for-tarifa') === st.tarifa); });
        qsa('[data-only]').forEach(function(d) { d.hidden = d.getAttribute('data-only') !== st.situacion; });
        $('when').hidden = !st.situacion || st.situacion === 'red' || (st.situacion === 'nueva' && st.solarMode !== 'manual');
        qsa('[data-solar]').forEach(function(d) { d.hidden = d.getAttribute('data-solar') !== (st.solarMode || 'auto'); });
        if (!st.billApplied) $('bill-result').hidden = true;
        qsa('[data-bind]').forEach(function(el) {
            var k = el.getAttribute('data-bind'), md = el.getAttribute('data-money');
            if (document.activeElement !== el) el.value = md !== null ? Math.round(toCur(st[k]) * Math.pow(10, +md)) / Math.pow(10, +md) : st[k];
        });
        qsa('[data-cur-unit]').forEach(function(u) { u.textContent = sym() + u.getAttribute('data-cur-unit'); });
        qsa('#cur-seg button').forEach(function(b) { b.classList.toggle('sel', b.getAttribute('data-cur') === st.moneda); });
        qsa('output[data-out]').forEach(function(o) {
            var k = o.getAttribute('data-out'), v = st[k];
            o.textContent = v === 0 && o.getAttribute('data-zero') ? o.getAttribute('data-zero') : num(v, v % 1 ? 1 : 0) + ' ' + o.getAttribute('data-unit');
        });
        qsa('[data-chips]').forEach(function(g) {
            var k = g.getAttribute('data-chips');
            qsa('button', g).forEach(function(b) { b.classList.toggle('sel', String(st[k]) === b.getAttribute('data-val')); });
        });
        $('t-custom').hidden = st.tarifa === 'gratis' || st.tarifa === 'fijo';
        syncNav();
    }

    function setValue(k, v) {
        st[k] = v;
        // Cambios que invalidan un presupuesto editado a mano
        if (k === 'qty' || k === 'minerKey' || k === 'cPrice') delete st.budget['bud-miners'];
        if (k === 'newKwp') ['bud-panels', 'bud-inverter', 'bud-mounting', 'bud-cabling', 'bud-labor', 'bud-permits'].forEach(function(b) { delete st.budget[b]; });
        if (k === 'newKwh') delete st.budget['bud-battery'];
        if (k === 'tarifa' && TARIFFS[v]) { st.punta = TARIFFS[v].punta; st.llano = TARIFFS[v].llano; st.valle = TARIFFS[v].valle; }
        if (k === 'tarifa' || k === 'punta' || k === 'llano' || k === 'valle' || k === 'fijo') st.billApplied = false;
        if (k === 'situacion' || k === 'solarMode') st.minerManual = false;   // otra instalación: vuelve a recomendar máquinas
        save();
        syncControls();
    }

    function bindWizard() {
        qsa('.tile[data-set]').forEach(function(t) {
            t.addEventListener('click', function() { setValue(t.getAttribute('data-set'), t.getAttribute('data-val')); });
        });
        qsa('[data-chips]').forEach(function(g) {
            var k = g.getAttribute('data-chips');
            g.addEventListener('click', function(e) {
                var b = e.target.closest('button');
                if (!b) return;
                var v = b.getAttribute('data-val');
                if (k === 'zona') {
                    st.hsp = null; st.lugar = ''; st.lat = null; st.lon = null;
                    $('loc-result').hidden = true; $('loc-status').textContent = '';
                    if (marker) { map.removeLayer(marker); marker = null; $('map-hint').hidden = false; }
                }
                setValue(k, /^[\d.]+$/.test(v) ? parseFloat(v) : v);
            });
        });
        qsa('[data-bind]').forEach(function(el) {
            el.addEventListener('input', function() {
                var v = parseFloat(String(el.value).replace(',', '.'));
                if (isNaN(v)) return;
                setValue(el.getAttribute('data-bind'), el.getAttribute('data-money') !== null ? fromCur(v) : v);
                if (st.step === 'maquinas') renderPicked();
            });
        });
        $('next').addEventListener('click', function() {
            if (!stepValid(st.step)) return;
            st._from = st.step;
            go(ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(st.step) + 1)]);
        });
        $('prev').addEventListener('click', function() {
            st._from = st.step;
            var i = ORDER.indexOf(st.step) - 1;
            if (ORDER[i] === 'ubicacion' && st.situacion === 'red') i--;
            go(ORDER[Math.max(0, i)]);
        });
        $('steps').addEventListener('click', function(e) {
            var b = e.target.closest('button');
            if (b && !b.disabled) { st._from = st.step; go(b.getAttribute('data-go')); }
        });
        $('loc-form').addEventListener('submit', function(e) { e.preventDefault(); searchPlace(); });
        if (LITE) lockBill();
        else $('bill-file').addEventListener('change', function() { if (this.files[0]) readBill(this.files[0]); this.value = ''; });
        $('budget-chips').addEventListener('click', function(e) {
            var b = e.target.closest('button');
            if (b) { setBudget(parseFloat(b.getAttribute('data-val'))); $('b-otro').value = ''; }
        });
        $('b-otro').addEventListener('input', function() {
            var v = parseFloat(this.value);
            if (!isNaN(v) && v >= 200) setBudget(v);
        });
        $('theme-btn').addEventListener('click', toggleTheme);
        $('cur-seg').addEventListener('click', function(e) {
            var b = e.target.closest('button');
            if (!b || b.getAttribute('data-cur') === st.moneda) return;
            st.moneda = b.getAttribute('data-cur');
            save();
            refreshAll();
        });
    }

    function refreshAll() {
        syncControls();
        showLive(document.getElementById('live').classList.contains('on'));
        showBill();
        if (st.step === 'presupuesto') renderBudget();
        else if (st.step === 'maquinas') renderMachines();
        else if (st.step === 'resultado') renderResult();
    }

    function toggleTheme() {
        var root = document.documentElement;
        var dark = root.getAttribute('data-theme') === 'dark' ||
            (!root.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
        root.setAttribute('data-theme', dark ? 'light' : 'dark');
        try { localStorage.setItem('solhash_theme', dark ? 'light' : 'dark'); } catch (e) {}
    }

    // ─── Ubicación (PVGIS vía Worker) ──────────────────────────────────────

    /** fetch de JSON con límite de tiempo: sin él, una conexión colgada deja la pantalla esperando */
    function fetchJSON(url, ms) {
        var ctrl = window.AbortController ? new AbortController() : null;
        var t = setTimeout(function() { if (ctrl) ctrl.abort(); }, ms || 12000);
        return fetch(url, ctrl ? { signal: ctrl.signal } : {})
            .then(function(r) { clearTimeout(t); return r.json(); }, function(e) { clearTimeout(t); throw e; });
    }

    // Datos de sol de un punto: primero la función propia en Vercel (mismo dominio, fuera de
    // Cloudflare), después el Worker, y si nada responde una estimación por latitud.
    var PVGIS_URLS = ['/api/pvgis', WORKER + '/pvgis'];
    function fetchPvgis(params, i) {
        i = i || 0;
        if (i >= PVGIS_URLS.length) return Promise.reject(new Error('sin servicio'));
        var qs = Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
        return fetchJSON(PVGIS_URLS[i] + '?' + qs, 15000).then(function(d) {
            if (d && d.ok && d.hsp) return d;
            if (d && d.message && /mar|cobertura|encuentro/i.test(d.message)) { var e = new Error(d.message); e.final = true; throw e; }
            throw new Error((d && d.message) || 'sin datos');
        }).catch(function(e) {
            if (e.final) throw e;
            return fetchPvgis(params, i + 1);
        });
    }

    /** Estimación de respaldo si PVGIS no responde: perfil por defecto escalado por la latitud */
    function estimateHSP(lat) {
        var f = Math.max(0.68, Math.min(1.02, 1 - (lat - 37.7) * 0.042));
        return SolHash.DEFAULT_HSP.map(function(v) { return Math.round(v * f * 100) / 100; });
    }

    var locToken = 0;
    function locate(lat, lon, label) {
        var status = $('loc-status'), token = ++locToken;
        status.className = 'status';
        status.textContent = 'Consultando las horas de sol de ese punto…';
        setMarker(lat, lon);
        fetchPvgis({ lat: lat.toFixed(4), lon: lon.toFixed(4) }).then(function(d) {
            if (token !== locToken) return;
            savePlace(d.hsp, lat, lon, label, false);
            status.textContent = '';
            if (!label) reverseName(lat, lon, token);
        }).catch(function(e) {
            if (token !== locToken) return;
            if (e.final) { status.textContent = e.message + '. Pincha sobre tierra firme.'; status.className = 'status err'; return; }
            savePlace(estimateHSP(lat), lat, lon, label, true);
            status.textContent = 'No he podido consultar PVGIS ahora mismo: uso una estimación para esa latitud. Vuelve a pinchar más tarde para afinarlo.';
            if (!label) reverseName(lat, lon, token);
        });
    }
    function savePlace(hsp, lat, lon, label, estimated) {
        st.hsp = hsp; st.lat = lat; st.lon = lon; st.zona = null; st.hspEstimated = !!estimated;
        st.lugar = label || (num(lat, 3) + ', ' + num(lon, 3));
        save(); syncControls(); showPlace();
    }
    /** Nombre del municipio para el punto pinchado (OpenStreetMap admite llamadas desde el navegador) */
    function reverseName(lat, lon, token) {
        fetchJSON('https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=es&lat=' + lat + '&lon=' + lon, 10000).then(function(d) {
            if (token !== locToken || !d || !d.address) return;
            var a = d.address, town = a.village || a.town || a.city || a.municipality || a.county;
            var region = a.province || a.state;
            if (town) { st.lugar = town + (region && region !== town ? ', ' + region : ''); save(); showPlace(); }
        }).catch(function() {});
    }

    function searchPlace() {
        var q = $('loc-q').value.trim(), status = $('loc-status');
        if (q.length < 2) { status.textContent = 'Escribe el nombre de tu municipio.'; status.className = 'status err'; return; }
        status.className = 'status';
        status.textContent = 'Buscando ' + q + '…';
        var query = /espa|spain|portugal/i.test(q) ? q : q + ', España';
        fetchJSON('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=' + encodeURIComponent(query), 10000).then(function(geo) {
            if (!geo || !geo.length) throw new Error('no');
            var lat = parseFloat(geo[0].lat), lon = parseFloat(geo[0].lon);
            var label = String(geo[0].display_name).split(',').slice(0, 2).join(',').trim();
            if (map) map.setView([lat, lon], 11);
            locate(lat, lon, label);
        }).catch(function() {
            status.textContent = 'No he encontrado "' + q + '". Prueba con "Municipio, Provincia" o pincha en el mapa.';
            status.className = 'status err';
        });
    }

    // Mapa (Leaflet + OpenStreetMap)
    var map = null, marker = null;
    function initMap() {
        if (map || !window.L || !$('map')) return;
        var has = st.lat !== undefined && st.lat !== null;
        L.Icon.Default.imagePath = 'vendor/leaflet/images/';
        map = L.map('map', { scrollWheelZoom: false }).setView(has ? [st.lat, st.lon] : [39.6, -4.2], has ? 10 : 6);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Sol: PVGIS © UE'
        }).addTo(map);
        map.on('click', function(e) { locate(e.latlng.lat, e.latlng.lng, null); });
        if (has) setMarker(st.lat, st.lon);
    }
    function setMarker(lat, lon) {
        if (!map) return;
        if (marker) marker.setLatLng([lat, lon]);
        else marker = L.marker([lat, lon]).addTo(map);
        $('map-hint').hidden = true;
    }

    function showPlace() {
        var box = $('loc-result');
        if (!st.hsp) { box.hidden = true; return; }
        var avg = st.hsp.reduce(function(a, b) { return a + b; }, 0) / 12, max = Math.max.apply(null, st.hsp);
        box.innerHTML = '<div class="where"><b>' + esc(st.lugar) + '</b><span>' + (st.hspEstimated ? 'Estimación por latitud: horas' : 'Horas') + ' de sol útil al día, de media</span></div>' +
            '<div class="hsp">' + num(avg, 1) + ' <small>h/día</small></div>' +
            '<div class="months" aria-label="Horas de sol por mes">' + st.hsp.map(function(v, i) {
                return '<i style="height:' + Math.round(v / max * 100) + '%" title="' + MONTHS[i] + ': ' + num(v, 1) + ' h"></i>';
            }).join('') + '</div>';
        box.hidden = false;
    }

    // ─── Factura de la luz ─────────────────────────────────────────────────

    var BILL_URLS = ['/api/factura', WORKER + '/parse-bill'];
    var BILL_TYPES = { precio_fijo: 'Mismo precio todo el día', tres_periodos: 'Tres franjas: punta, llano y valle', dos_periodos: 'Dos franjas: día y noche', pvpc: 'Precio regulado (PVPC)' };

    function postJSON(urls, body, ms, i) {
        i = i || 0;
        if (i >= urls.length) return Promise.reject(new Error('El lector de facturas no responde. Inténtalo en unos minutos.'));
        var ctrl = window.AbortController ? new AbortController() : null;
        var t = setTimeout(function() { if (ctrl) ctrl.abort(); }, ms);
        return fetch(urls[i], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: ctrl ? ctrl.signal : undefined })
            .then(function(r) {
                clearTimeout(t);
                if (r.status === 404 || r.status === 405) return postJSON(urls, body, ms, i + 1);   // sin función local: prueba el siguiente
                return r.json().catch(function() { throw new Error('Respuesta no válida'); });
            }, function() { clearTimeout(t); return postJSON(urls, body, ms, i + 1); });
    }

    /** PDF tal cual; las fotos se reducen a 2000 px en JPEG para que viajen rápido */
    function fileToPayload(file) {
        return new Promise(function(resolve, reject) {
            var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
            if (isPdf) {
                if (file.size > 3.2 * 1024 * 1024) return reject(new Error('El PDF ocupa demasiado. Prueba con una foto o una captura de la página de precios.'));
                var fr = new FileReader();
                fr.onload = function() { resolve({ file: String(fr.result).split(',')[1], mediaType: 'application/pdf' }); };
                fr.onerror = function() { reject(new Error('No he podido abrir el archivo.')); };
                return fr.readAsDataURL(file);
            }
            if (!/^image\//.test(file.type)) return reject(new Error('Sube un PDF o una foto de la factura.'));
            var img = new Image(), url = URL.createObjectURL(file);
            img.onload = function() {
                var max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
                var c = document.createElement('canvas');
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                resolve({ file: c.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' });
            };
            img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('No puedo abrir esa imagen. Prueba con una foto en JPG o con el PDF.')); };
            img.src = url;
        });
    }

    function readBill(file) {
        var status = $('bill-status'), btn = $('bill-btn');
        status.className = 'status';
        status.textContent = 'Leyendo tu factura… tarda unos segundos.';
        btn.classList.add('busy');
        var creds = window.LicenseGate && LicenseGate.getCredentials ? LicenseGate.getCredentials() : {};
        fileToPayload(file).then(function(p) {
            return postJSON(BILL_URLS, JSON.stringify({ key: creds.key, email: creds.email, file: p.file, mediaType: p.mediaType }), 60000);
        }).then(function(d) {
            btn.classList.remove('busy');
            if (!d || !d.ok) throw new Error((d && d.message) || 'No he podido leer la factura.');
            var b = d.bill;
            if (!b.es_factura_luz) throw new Error('Eso no parece una factura de la luz. Prueba con otra página o con el PDF completo.');
            if (!applyBill(b)) throw new Error('He leído la factura pero no encuentro el precio de la energía. Elige tu tarifa abajo y escribe los precios.');
            status.textContent = '';
        }).catch(function(e) {
            btn.classList.remove('busy');
            status.textContent = e.message;
            status.className = 'status err';
        });
    }

    function taxFactor(b) {
        if (b.precios_incluyen_impuestos) return 1;
        var iva = b.iva_pct !== null && b.iva_pct !== undefined ? b.iva_pct : 21;
        var iee = b.iee_pct !== null && b.iee_pct !== undefined ? b.iee_pct : 5.11;
        return (1 + iee / 100) * (1 + iva / 100);
    }
    function r4(n) { return Math.round(n * 10000) / 10000; }

    /** Pasa los precios de la factura (con impuestos) al cálculo. Devuelve false si no hay precios */
    function applyBill(b) {
        var f = taxFactor(b);
        var p = b.precio_punta, l = b.precio_llano, v = b.precio_valle, u = b.precio_unico;
        var periods = p || l || v;
        if (!periods && !u) return false;
        if (periods) {
            p = p || l || v; l = l || p; v = v || l;
            st.tarifa = '2.0td'; st.punta = r4(p * f); st.llano = r4(l * f); st.valle = r4(v * f);
        } else {
            st.tarifa = 'fijo'; st.fijo = r4(u * f);
        }
        st.bill = b; st.billApplied = true;
        save(); syncControls(); showBill();
        return true;
    }

    /** Lite: en vez de subir la factura, se explica que eso es de la Pro (se elige la tarifa a mano) */
    function lockBill() {
        var cta = document.querySelector('#bill .bill-cta'), icon = cta.querySelector('svg');
        cta.classList.add('locked');
        cta.innerHTML = (icon ? icon.outerHTML : '') +
            '<div><b>Leer tu factura automáticamente ' + proBadge() + '</b>' +
            '<span>En SolHash Pro subes la factura en PDF o en foto y tu tarifa y tus precios se rellenan solos. Aquí elige tu tarifa abajo.</span></div>' +
            '<a class="btn-ghost" href="' + PRO_URL + '" target="_blank" rel="noopener">Ver SolHash Pro</a>';
        var priv = document.querySelector('#bill .bill-privacy'), or = document.querySelector('.step[data-step="luz"] .or');
        if (priv) priv.hidden = true;
        if (or) or.textContent = 'Elige tu tipo de tarifa';
    }
    function proBadge() { return '<span class="pro-badge">SolHash Pro</span>'; }

    function showBill() {
        var box = $('bill-result'), b = st.bill;
        if (!b || !st.billApplied) { box.hidden = true; return; }
        var f = taxFactor(b), rows;
        if (b.precio_punta || b.precio_llano || b.precio_valle) {
            rows = [['Punta', b.precio_punta || b.precio_llano || b.precio_valle], ['Llano', b.precio_llano || b.precio_punta], ['Valle', b.precio_valle || b.precio_llano]];
        } else rows = [['Todas las horas', b.precio_unico]];
        var title = [b.comercializadora, b.nombre_tarifa].filter(Boolean).join(' · ') || 'Tu factura';
        var tax = b.precios_incluyen_impuestos ? 'La factura ya da los precios con impuestos.'
            : 'Con impuestos = precio de la factura + impuesto eléctrico (' + num(b.iee_pct !== null ? b.iee_pct : 5.11, 2) + ' %) + IVA (' + num(b.iva_pct !== null ? b.iva_pct : 21) + ' %).';
        box.innerHTML = '<div class="bill-head"><b>' + esc(title) + '</b><span>' + esc(BILL_TYPES[b.tipo] || 'Tarifa') + '</span></div>' +
            '<table class="months-t"><tr><th>Franja</th><th>En la factura</th><th>Con impuestos</th></tr>' + rows.map(function(rw) {
                return '<tr><td>' + rw[0] + '</td><td>' + kwh(rw[1], 4) + '</td><td><b>' + kwh(rw[1] * f, 4) + '</b></td></tr>';
            }).join('') + '</table>' +
            '<p class="help">' + tax + (b.potencia_kw ? ' Potencia contratada: ' + num(b.potencia_kw, 2) + ' kW.' : '') +
            (b.notas ? ' ' + esc(b.notas) : '') + '</p>' +
            '<p class="bill-ok">He aplicado estos precios a tu cálculo. Puedes cambiarlos abajo si algo no cuadra.</p>';
        box.hidden = false;
    }

    // ─── Paso de máquinas ──────────────────────────────────────────────────

    var recCache = null;
    function renderMachines() {
        if (st.minerKey && st.minerKey !== 'custom' && window.SolHashCatalog) st.minerKey = SolHashCatalog.resolve(st.minerKey);
        if (st.situacion === 'nueva' && st.solarMode !== 'manual') { renderProject(); return; }
        $('maq-title').textContent = 'Elige tus máquinas';
        recCache = recommend();
        var noFit = false;
        if (!recCache.length && machinesBudget()) {
            noFit = true;
            recCache = recommend(null).sort(function(x, y) { return x.r.totalInvestment - y.r.totalInvestment; });   // las más asequibles primero
        }
        if (!st.minerManual && recCache.length) {
            st.minerKey = recCache[0].inputs.minerKey;
            st.qty = recCache[0].inputs.qty;
            delete st.budget['bud-miners'];
        }
        var cheapest = Object.keys(SolHash.MINERS).filter(function(k) { var m = SolHash.MINERS[k]; return k !== 'custom' && m.ready && m.cooling === 'aire' && m.powerKW >= 1; })
            .reduce(function(a, k) { return !a || SolHash.MINERS[k].price < SolHash.MINERS[a].price ? k : a; }, null);
        $('rec-lead').textContent = noFit
            ? 'Con ' + eur(machinesBudget()) + ' no llega para una máquina de calidad: la más barata cuesta ' + (cheapest ? eur(SolHash.MINERS[cheapest].price) : '—') + '. Estas son las opciones más asequibles.'
            : recCache.length && recCache[0].net5 < 0
            ? 'Con los precios de hoy, ninguna máquina recupera lo que cuesta en 5 años con tu ' + (st.situacion === 'red' ? 'tarifa' : 'energía') +
              '. Estas son las que más recuperan (hasta un ' + num(Math.min(99, recCache[0].recov5 * 100)) + ' % de lo invertido).'
            : st.situacion === 'red'
            ? 'Sin placas, todo sale de la factura. Estas son las que mejor salen con tu tarifa y tu presupuesto.'
            : 'Estas son las que mejor encajan con tu energía y tu presupuesto, con los precios de hoy.';
        $('recs').innerHTML = recCache.map(function(c, i) {
            var m = c.inputs.miner;
            return '<button type="button" class="rec' + (c.inputs.minerKey === st.minerKey ? ' sel' : '') + '" data-key="' + esc(c.inputs.minerKey) + '" data-qty="' + c.inputs.qty + '">' +
                '<span class="tag">' + (i === 0 ? 'La mejor para ti' : i === 1 ? 'Alternativa' : 'Otra opción') + '</span>' +
                '<b>' + c.inputs.qty + ' × ' + esc(m.name) + '</b>' +
                '<span class="kv">Recuperas la inversión en <strong>' + months(c.payback) + '</strong></span>' +
                '<span class="kv">Ganas el primer año <strong class="' + (c.year1 < 0 ? 'bad' : '') + '">' + eur(c.year1) + '</strong></span>' +
                '<span class="kv">Consumo <strong>' + num(m.powerKW * c.inputs.qty, 1) + ' kW</strong></span>' +
                '</button>';
        }).join('');
        qsa('.rec', $('recs')).forEach(function(b) {
            b.addEventListener('click', function() {
                st.minerManual = true;
                setValue('minerKey', b.getAttribute('data-key'));
                st.qty = parseInt(b.getAttribute('data-qty'), 10);
                save();
                qsa('.rec', $('recs')).forEach(function(x) { x.classList.toggle('sel', x === b); });
                $('m-select').value = st.minerKey;
                $('custom-fields').hidden = true;
                renderPicked();
            });
        });
        buildSelect();
        renderPicked();
        syncNav();
    }

    var projCache = null;
    function sameDesign(c) {
        return c.inputs.minerKey === st.minerKey && c.inputs.qty === st.qty && c.design.kwp === st.newKwp && c.design.kwh === st.newKwh && c.strat === st.estrategia;
    }
    function applyDesign(c) {
        st.newKwp = c.design.kwp; st.newKwh = c.design.kwh; st.estrategia = c.strat;
        st.minerKey = c.inputs.minerKey; st.qty = c.inputs.qty;
        delete st.budget['bud-miners'];
        save();
    }
    function renderProject() {
        $('maq-title').textContent = 'Tu proyecto';
        $('rec-lead').textContent = 'Diseñando tu instalación con tu presupuesto…';
        $('recs').innerHTML = '';
        $('picked').innerHTML = '';
        setTimeout(function() {
            projCache = designProject();
            var B = st.presupuesto > 0 ? st.presupuesto : 10000;
            if (!projCache.length) {
                $('rec-lead').textContent = 'Con ' + eur(B) + ' no llega para montar placas y una máquina. Prueba con un presupuesto mayor o elige "Ya sé lo que quiero montar".';
                syncNav();
                return;
            }
            if (!st.minerManual) applyDesign(projCache[0]);
            var best = projCache[0];
            $('rec-lead').textContent = (st.presupuesto > 0 ? 'Con ' + eur(B) : 'Para unos ' + eur(B) + ' (no indicaste presupuesto)') +
                (best.net5 >= 0 ? ', estas son las instalaciones que más te dejan en 5 años. Elige una y podrás cambiar la máquina.'
                                : '. Aviso: con los precios de hoy, ninguna instalación nueva recupera todo lo invertido en 5 años; la que más se acerca recupera un ' +
                                  num(Math.min(99, best.recov5 * 100)) + ' %. Estas son las que mejor salen.');
            $('recs').innerHTML = projCache.map(function(c, i) {
                var d = c.design, m = c.inputs.miner;
                return '<button type="button" class="rec proj' + (sameDesign(c) ? ' sel' : '') + '" data-i="' + i + '">' +
                    '<span class="tag">' + (i === 0 ? 'La mejor para ti' : i === 1 ? 'Alternativa' : 'Otra opción') + '</span>' +
                    '<b>' + c.inputs.qty + ' × ' + esc(m.name) + '</b>' +
                    '<span class="kv">Placas<strong>' + d.panels + ' × ' + SOLAR_MATERIALS.panel.w + ' W</strong></span>' +
                    '<span class="kv">Inversor<strong>' + num(d.inverter.kw, d.inverter.kw % 1 ? 1 : 0) + ' kW</strong></span>' +
                    '<span class="kv">Batería<strong>' + (d.kwh ? num(d.kwh, 1) + ' kWh' : 'Sin batería') + '</strong></span>' +
                    '<span class="kv">Minan<strong>' + (c.strat === '24h' ? 'Día y noche' : 'Solo con sol') + '</strong></span>' +
                    '<span class="kv">Inversión total<strong>' + eur(c.r.totalInvestment) + '</strong></span>' +
                    '<span class="kv">Recuperas en<strong>' + months(c.payback) + '</strong></span>' +
                    '<span class="kv">Ganas el primer año<strong class="' + (c.year1 < 0 ? 'bad' : '') + '">' + eur(c.year1) + '</strong></span>' +
                    '</button>';
            }).join('');
            qsa('.rec', $('recs')).forEach(function(b) {
                b.addEventListener('click', function() {
                    applyDesign(projCache[parseInt(b.getAttribute('data-i'), 10)]);
                    st.minerManual = true; save();
                    qsa('.rec', $('recs')).forEach(function(x) { x.classList.toggle('sel', x === b); });
                    $('m-select').value = st.minerKey;
                    renderPicked();
                });
            });
            buildSelect();
            renderPicked();
            syncNav();
        }, 40);
    }

    function buildSelect() {
        var sel = $('m-select'), M = SolHash.MINERS;
        var groups = [['Aire, en stock', function(m) { return m.cooling === 'aire' && m.ready; }],
                      ['Aire, bajo pedido', function(m) { return m.cooling === 'aire' && !m.ready; }],
                      ['Refrigeración líquida', function(m) { return m.cooling === 'hidro'; }],
                      ['Inmersión', function(m) { return m.cooling && m.cooling !== 'aire' && m.cooling !== 'hidro'; }]];
        var html = '';
        groups.forEach(function(g) {
            var opts = Object.keys(M).filter(function(k) { return k !== 'custom' && g[1](M[k]); }).map(function(k) {
                return '<option value="' + esc(k) + '">' + esc(M[k].name) + (M[k].ready ? '' : ' — ' + esc(M[k].delivery)) + ' · ' + eur(M[k].price) + '</option>';
            }).join('');
            if (opts) html += '<optgroup label="' + g[0] + '">' + opts + '</optgroup>';
        });
        html += '<optgroup label="Otro"><option value="custom">Mi equipo no está: lo introduzco a mano</option></optgroup>';
        sel.innerHTML = html;
        sel.value = st.minerKey || '';
        $('custom-fields').hidden = st.minerKey !== 'custom';
        sel.onchange = function() {
            st.minerManual = true;
            setValue('minerKey', sel.value);
            $('custom-fields').hidden = sel.value !== 'custom';
            qsa('.rec', $('recs')).forEach(function(x) { x.classList.toggle('sel', x.getAttribute('data-key') === sel.value); });
            renderPicked();
        };
    }

    function renderPicked() {
        var m = minerFor(st.minerKey), box = $('picked');
        if (!m) { box.innerHTML = '<span class="help">Elige una máquina de las recomendadas o de la lista completa.</span>'; return; }
        box.innerHTML = '<div class="what"><b>' + esc(m.name) + '</b><span>' + num(m.hashrate, m.hashrate < 100 ? 1 : 0) + ' TH/s · consume ' + num(m.powerKW, 2) + ' kW · ' +
            (m.cooling === 'aire' ? 'refrigeración por aire' : m.cooling === 'hidro' ? 'refrigeración líquida' : 'inmersión') + '</span></div>' +
            '<div><span class="help" style="display:block;margin:0 0 6px">Cuántas</span><div class="stepper"><button type="button" data-d="-1" aria-label="Una menos">−</button>' +
            '<input type="number" id="qty" min="1" max="100" value="' + st.qty + '" aria-label="Número de máquinas"><button type="button" data-d="1" aria-label="Una más">+</button></div></div>' +
            '<div class="price">' + eur(m.price * st.qty) + '<small>' + (st.qty > 1 ? eur(m.price) + ' cada una' : 'precio de la máquina') + '</small></div>';
        qsa('[data-d]', box).forEach(function(b) {
            b.addEventListener('click', function() {
                st.minerManual = true;
                setValue('qty', Math.max(1, Math.min(100, st.qty + parseInt(b.getAttribute('data-d'), 10))));
                renderPicked();
            });
        });
        $('qty').addEventListener('change', function() {
            var v = parseInt(this.value, 10);
            st.minerManual = true;
            setValue('qty', isNaN(v) ? 1 : Math.max(1, Math.min(100, v)));
            renderPicked();
        });
        syncNav();
    }

    // ─── Resultado ─────────────────────────────────────────────────────────

    function verdict(c) {
        if (c.payback !== null && c.payback <= 24) return { cls: 'verdict-good', title: 'Sí, te sale rentable' };
        if (c.payback !== null && c.payback <= 60) return { cls: 'verdict-mid', title: 'Rentable, pero a largo plazo' };
        return { cls: 'verdict-bad', title: 'Así no te sale rentable' };
    }

    function heroText(c) {
        var r = c.r;
        if (c.payback !== null) {
            return 'Ganas unos <b>' + eur(c.year1) + '</b> el primer año. Cada año algo menos: la red de Bitcoin se vuelve más exigente y en abril de 2028 la recompensa baja a la mitad (el halving). Ya está incluido.';
        }
        if (c.year1 <= 0) {
            return 'Las máquinas gastan ' + (r.maintenanceYear > 0 ? 'en luz y mantenimiento' : 'en luz') + ' (' + eur(r.gridCostYear + r.maintenanceYear) + ' al año) más de lo que generan (' + eur(c.rev1) + '). ' +
                (st.situacion === 'red' ? 'Sin placas, la luz de la red se come el beneficio.' : 'Prueba con menos máquinas, más placas o una batería.');
        }
        return 'Ganas ' + eur(c.year1) + ' el primer año, pero la inversión de ' + eur(r.totalInvestment) + ' no se recupera en 10 años porque los ingresos bajan cada año.';
    }

    function renderResult() {
        applyHSP();
        var c = calc();
        lastCalc = c;
        if (!c) { $('result').innerHTML = '<p class="lead">Falta elegir una máquina.</p>'; return; }
        var r = c.r, i = c.inputs, v = verdict(c), m = i.miner;
        var own = r.solarDirectYear + r.batteryYear, totalE = own + r.gridYearKWh;
        var ownPct = totalE > 0 ? own / totalE * 100 : 0;

        var html = summaryHTML(i) +
            '<section class="hero" aria-label="Resultado">' +
                '<div><p class="kicker">Tu resultado</p><h1 class="' + v.cls + '">' + v.title + '</h1>' +
                    (c.payback !== null
                        ? '<div class="hero-num">' + months(c.payback).replace(/ (meses|mes|años)$/, '<small>$1</small>') + '</div>'
                        : '<div class="hero-num hero-num-no">' + (c.year1 > 0 ? 'Más de 10 años' : 'Pierde dinero') + '</div>') +
                    '<p class="hero-sub">' + (c.payback !== null ? 'para recuperar todo lo que inviertes. ' : '') + heroText(c) + '</p>' +
                    '<div class="hero-stats"><div><span>Inversión</span><b>' + eur(r.totalInvestment) + '</b></div>' +
                    '<div><span>Ganas el primer año</span><b>' + eur(c.year1) + '</b></div>' +
                    '<div><span>Bitcoin el primer año</span><b>' + btc(c.btc1) + ' BTC</b></div></div></div>' +
                '<div class="ring-wrap">' + ringSVG(r, ownPct) +
                    '<div class="legend"><span><i style="background:#f29a1f"></i>Sol</span><span><i style="background:#2bb38a"></i>Batería</span>' +
                    '<span><i style="background:#c3d0df"></i>Red, valle</span><span><i style="background:#8ea3bd"></i>Red, llano</span><span><i style="background:#5d7698"></i>Red, punta</span></div></div>' +
            '</section>' +
            genHTML(c) +
            '<div class="actions">' +
                (LITE
                    ? '<a class="btn btn-sun" target="_blank" rel="noopener" href="' + waLink(c) + '">Hablar con Marcos por WhatsApp</a>' +
                      '<a class="btn-ghost" target="_blank" rel="noopener" href="' + PRO_URL + '">Informe en PDF ' + proBadge() + '</a>'
                    : '<button type="button" class="btn btn-sun" id="pdf-btn">Descargar informe en PDF</button>' +
                      '<a class="btn-ghost" target="_blank" rel="noopener" href="' + waLink(c) + '">Hablar con Marcos por WhatsApp</a>') +
                '<button type="button" class="btn-ghost" id="edit-btn">Cambiar mis datos</button>' +
            '</div>' +
            '<div class="grid">' +
                moneyCard(c) + (st.situacion === 'nueva' ? materialsCard(c) : '') + energyCard(c, ownPct) + whatIfCard(c) + compareCard(c) + needsCard(c) +
                (st.situacion === 'nueva' ? '' : budgetCard(c)) + (LITE ? proCard() : advancedCard()) +
            '</div>' +
            '<p class="foot">Cálculo con el mismo motor que SolHash Pro: radiación ' + (st.hsp ? 'de PVGIS para ' + esc(st.lugar) : 'media de ' + (ZONES[st.zona] || ZONES.centro).label) +
                ', Bitcoin a ' + eur(c.price) + ', dificultad de la red +25 % al año y halving en abril de 2028. Precios de máquinas de la lista del ' +
                (window.MACHINES_DATA ? new Date(MACHINES_DATA.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—') +
                '. Estimación orientativa: no garantiza resultados futuros.</p>';
        $('result').innerHTML = html;
        bindResult(c);
    }

    /** Lo que genera la instalación al día, al mes y el primer año: en bitcoin, en dinero y lo que te queda */
    function genHTML(c) {
        var r = c.r, price = c.price, q = c.inputs.qty;
        var day = r.yearlyBTC / 365, costDay = (r.gridCostYear + r.maintenanceYear) / 365;
        var cols = [
            ['Al día', 'al ritmo de hoy', day, day * price, day * price - costDay],
            ['Al mes', 'al ritmo de hoy', day * 30.44, day * 30.44 * price, (day * price - costDay) * 30.44],
            ['El primer año', 'con la red cada vez más exigente', c.btc1, c.rev1, c.year1]
        ];
        return '<section class="gen" aria-label="Lo que genera">' +
            '<h2>Lo que genera ' + (q > 1 ? 'tu instalación de ' + q + ' máquinas' : 'tu máquina') + '</h2>' +
            '<div class="gen-grid">' + cols.map(function(col) {
                var sats = Math.round(col[2] * 1e8);
                return '<div class="gen-col"><span class="gen-when">' + col[0] + '<small>' + col[1] + '</small></span>' +
                    '<b class="gen-btc">' + btcFine(col[2]) + ' BTC</b>' +
                    (sats < 1e6 ? '<span class="gen-sats">' + num(sats) + ' satoshis</span>' : '') +
                    '<span class="gen-eur">≈ ' + eurFine(col[3]) + '</span>' +
                    '<span class="gen-net ' + (col[4] < 0 ? 'bad' : 'good') + '">Te quedan ' + eurFine(col[4]) + '</span></div>';
            }).join('') + '</div>' +
            '<p class="help">"Te quedan" es lo que generas menos la luz' + (r.gridCostYear > 0 ? '' : ' (en tu caso, gratis)') +
                (r.maintenanceYear > 0 ? ' y el mantenimiento que has puesto' : '') + '. Bitcoin a ' + eur(price) + '.</p></section>';
    }

    function summaryHTML(i) {
        var pen = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
        var sit = st.situacion === 'casa' ? 'Placas en casa · ' + num(st.casaKwp, 1) + ' kWp'
            : st.situacion === 'dedicada' ? 'Instalación de ' + num(st.existKwp + st.addKwp, 1) + ' kWp'
            : st.situacion === 'nueva' ? 'Placas nuevas · ' + num(st.newKwp, 1) + ' kWp' : 'Sin placas';
        var bat = i.surplusMode ? st.casaBateria : (st.situacion === 'dedicada' ? st.existKwh + st.addKwh : i.batteryKWh);
        if (bat > 0) sit += ' + ' + num(bat) + ' kWh';
        var where = st.situacion === 'red' ? null : (st.hsp ? st.lugar : (ZONES[st.zona] || ZONES.centro).label);
        var pre = TARIFFS[st.tarifa];
        var edited = pre && st.tarifa !== 'gratis' && (pre.punta !== st.punta || pre.llano !== st.llano || pre.valle !== st.valle);
        var luz = st.billApplied && st.bill ? 'Tu factura' + (st.bill.comercializadora ? ' (' + st.bill.comercializadora + ')' : '')
            : st.tarifa === 'fijo' ? 'Luz a ' + kwh(st.fijo, 3) : edited ? 'Tus precios de luz' : pre.label;
        var chips = [['situacion', sit]];
        if (where) chips.push(['ubicacion', where]);
        chips.push(['luz', luz], ['maquinas', i.qty + ' × ' + i.miner.name]);
        return '<div class="summary" aria-label="Tu proyecto">' + chips.map(function(ch) {
            return '<button type="button" data-edit="' + ch[0] + '" title="Cambiar">' + esc(ch[1]) + pen + '</button>';
        }).join('') + '</div>';
    }

    // Reloj de 24 h: de dónde sale la energía de las máquinas cada hora de un día medio
    function ringSVG(r, ownPct) {
        var C = 160, R0 = 70, L = 76, gap = 0.012;
        var hb = r.hourlyBreakdown, max = 0;
        hb.forEach(function(h) { max = Math.max(max, h.solar + h.battery + h.gridValle + h.gridLlano + h.gridPunta); });
        if (max <= 0) max = 1;
        function ang(h) { return ((h - 12) / 24) * 2 * Math.PI - Math.PI / 2; }
        function pt(a, rad) { return (C + rad * Math.cos(a)).toFixed(2) + ' ' + (C + rad * Math.sin(a)).toFixed(2); }
        function sector(a0, a1, r0, r1) {
            return 'M' + pt(a0, r0) + 'L' + pt(a0, r1) + 'A' + r1 + ' ' + r1 + ' 0 0 1 ' + pt(a1, r1) + 'L' + pt(a1, r0) + 'A' + r0 + ' ' + r0 + ' 0 0 0 ' + pt(a0, r0) + 'Z';
        }
        var s = '';
        for (var h = 0; h < 24; h++) {
            var a0 = ang(h) + gap, a1 = ang(h + 1) - gap, x = hb[h];
            s += '<path d="' + sector(a0, a1, R0, R0 + L) + '" fill="rgba(255,255,255,0.05)"/>';
            var parts = [[x.solar, '#f29a1f'], [x.battery, '#2bb38a'], [x.gridValle, '#c3d0df'], [x.gridLlano, '#8ea3bd'], [x.gridPunta, '#5d7698']];
            var rad = R0;
            parts.forEach(function(p) {
                if (p[0] <= 0) return;
                var len = p[0] / max * L;
                s += '<path d="' + sector(a0, a1, rad, rad + len) + '" fill="' + p[1] + '"/>';
                rad += len;
            });
        }
        var labels = [[12, '12 h'], [18, '18 h'], [0, '0 h'], [6, '6 h']].map(function(l) {
            var a = ang(l[0]), rr = R0 - 14;
            return '<text x="' + (C + rr * Math.cos(a)).toFixed(1) + '" y="' + (C + rr * Math.sin(a) + 4).toFixed(1) + '" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.55)">' + l[1] + '</text>';
        }).join('');
        return '<svg class="ring" viewBox="0 0 320 320" role="img" aria-label="Energía de las máquinas en un día medio: ' + Math.round(ownPct) + ' % propia">' + s + labels +
            '<text x="160" y="160" text-anchor="middle" font-size="40" font-weight="750" fill="#fff" style="font-stretch:112%">' + Math.round(ownPct) + '%</text>' +
            '<text x="160" y="182" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.7)">energía propia</text></svg>';
    }

    function moneyCard(c) {
        var r = c.r, neg = c.year1 < 0;
        return '<article class="card full"><h2>Tu dinero</h2>' +
            '<p class="what">Lo que generan las máquinas el primer año, lo que pagas de luz y lo que te queda. La línea muestra cómo se recupera la inversión año a año.</p>' +
            '<div class="money"><div><span>Generas</span><b>' + eur(c.rev1) + '</b></div><span class="op">−</span>' +
            '<div><span>Luz de la red</span><b>' + eur(r.gridCostYear) + '</b></div><span class="op">' + (r.maintenanceYear > 0 ? '−' : '=') + '</span>' +
            (r.maintenanceYear > 0 ? '<div><span>Mantenimiento</span><b>' + eur(r.maintenanceYear) + '</b></div><span class="op">=</span>' : '') +
            '<div class="res' + (neg ? ' neg' : '') + '"><span>Te quedan el primer año</span><b>' + eur(c.year1) + '</b></div></div>' +
            lineSVG(c) +
            (c.offMonth ? '<p class="help">' + (c.offMonth <= 1
                ? 'Con estos números la máquina gasta más de lo que genera desde el primer mes: no compensa encenderla.'
                : 'Hacia el mes ' + c.offMonth + ' la máquina pasaría a gastar más de lo que genera (la red se vuelve más difícil y llega el halving). El cálculo supone que entonces la apagas.') + '</p>' : '') +
            '</article>';
    }

    function lineSVG(c) {
        var W = 920, H = 250, Lp = 64, R = 16, T = 18, B = 30, a = c.acc.map(toCur);
        var min = Math.min.apply(null, a.concat([0])), max = Math.max.apply(null, a.concat([0]));
        var pad = (max - min) * 0.08 || 1;
        min -= pad; max += pad;
        function x(i) { return Lp + (W - Lp - R) * i / 10; }
        function y(v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); }
        var step = niceStep((max - min) / 4), s = '';
        for (var g = Math.ceil(min / step) * step; g <= max; g += step) {
            s += '<line x1="' + Lp + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" stroke="var(--line)"/>' +
                '<text x="' + (Lp - 8) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + num(g) + '</text>';
        }
        s += '<line x1="' + Lp + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--line-strong)" stroke-width="1.5"/>';
        var d = a.map(function(v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
        s += '<path d="' + d + 'L' + x(10) + ' ' + y(0).toFixed(1) + 'L' + x(0) + ' ' + y(0).toFixed(1) + 'Z" fill="var(--sun-soft)"/>' +
             '<path d="' + d + '" fill="none" stroke="var(--sun)" stroke-width="3" stroke-linejoin="round"/>';
        for (var i = 0; i <= 10; i++) s += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === 10 ? 'end' : 'middle') + '">' + (i === 0 ? 'Hoy' : 'Año ' + i) + '</text>';
        if (c.payback !== null && c.payback <= 120) {
            var px = Lp + (W - Lp - R) * (c.payback / 120);
            s += '<circle cx="' + px.toFixed(1) + '" cy="' + y(0).toFixed(1) + '" r="6" fill="var(--good)"/>' +
                '<text x="' + (px + (c.payback > 90 ? -10 : 10)).toFixed(1) + '" y="' + (y(0) - 10).toFixed(1) + '" class="v" text-anchor="' + (c.payback > 90 ? 'end' : 'start') + '">Inversión recuperada: ' + months(c.payback) + '</text>';
        }
        s += '<text x="' + (W - R) + '" y="' + (y(a[10]) - 10).toFixed(1) + '" text-anchor="end" class="v">' + signed(c.acc[10]) + ' en 10 años</text>';
        return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Dinero acumulado en 10 años">' + s + '</svg>';
    }
    function niceStep(raw) {
        var p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
        var n = raw / p;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
    }

    function energyCard(c, ownPct) {
        var r = c.r, tot = r.solarDirectYear + r.batteryYear + r.gridYearKWh || 1;
        function pc(v) { return v / tot * 100; }
        var extra = '';
        if (c.inputs.surplusStrategy === 'surplus-only') {
            extra = '<p class="what" style="margin-top:14px">Como solo minan con tu sol, las máquinas funcionan unas <b>' + num(r.hoursRunning, 0) + ' horas al día</b> de media.';
            if (c.inputs.surplusMode) {
                var sb = SolHash.calculateSurplusBenefit(r, c.inputs);
                extra += ' Ese sol, vendido a la red, te daría ' + eur(sb.eurIfSoldToGrid) + ' al año; minando te da ' + eur(sb.eurFromSurplus) + (sb.multiplier ? ' (' + num(sb.multiplier, 1) + ' veces más)' : '') + '.';
            }
            extra += '</p>';
        }
        var rows = r.monthlyData.map(function(mo) {
            return '<tr><td>' + mo.month + '</td><td>' + num(mo.hsp, 1) + ' h</td><td>' + num(mo.solarKWh) + '</td><td>' + num(mo.batteryKWh) + '</td><td>' + num(mo.gridKWh) + '</td><td>' + eur(mo.gridCost) + '</td></tr>';
        }).join('');
        return '<article class="card"><h2>Tu energía</h2>' +
            '<p class="what">De dónde sale la electricidad que gastan las máquinas en un año. Cuanto más sale de tu sol, menos pagas.</p>' +
            '<div class="split" role="img" aria-label="' + Math.round(ownPct) + ' % de energía propia"><i style="width:' + pc(r.solarDirectYear) + '%;background:var(--sun)"></i><i style="width:' + pc(r.batteryYear) + '%;background:var(--batt)"></i><i style="width:' + pc(r.gridYearKWh) + '%;background:var(--g-llano)"></i></div>' +
            '<div class="split-legend"><div><i style="background:var(--sun)"></i>Sol directo<b>' + num(r.solarDirectYear) + ' kWh</b></div>' +
            '<div><i style="background:var(--batt)"></i>Batería<b>' + num(r.batteryYear) + ' kWh</b></div>' +
            '<div><i style="background:var(--g-llano)"></i>Red<b>' + num(r.gridYearKWh) + ' kWh</b></div></div>' + extra +
            '<details class="more"><summary>Ver mes a mes</summary><div class="table-wrap"><table class="months-t"><tr><th>Mes</th><th>Sol</th><th>Sol kWh</th><th>Batería kWh</th><th>Red kWh</th><th>Coste red</th></tr>' + rows + '</table></div></details>' +
            '</article>';
    }

    function whatIfCard(c) {
        var target = st.btcTarget || c.price;
        return '<article class="card"><h2>¿Y si Bitcoin sube?</h2>' +
            '<p class="what">Si guardas los bitcoins que minas en vez de venderlos, su valor depende del precio futuro. Mueve el precio y mira cuánto valdría lo minado en 5 años.</p>' +
            '<div class="presets" id="wi-presets">' + [[1, 'Como hoy'], [1.5, '× 1,5'], [2, '× 2'], [3, '× 3']].map(function(p) {
                return '<button type="button" data-k="' + p[0] + '">' + p[1] + '</button>';
            }).join('') + '</div>' +
            '<div class="slider-row"><input type="range" id="wi-range" min="20000" max="400000" step="1000" value="' + Math.round(target) + '" aria-label="Precio de Bitcoin dentro de 5 años"><output id="wi-out"></output></div>' +
            '<div class="kvs one" id="wi-kvs"></div></article>';
    }
    function updateWhatIf(c) {
        var p = parseFloat($('wi-range').value), r = c.r;
        var costs = r.totalInvestment + c.opex5;
        var value = c.btc5 * p, net = value - costs;
        $('wi-out').textContent = eur(p);
        $('wi-kvs').innerHTML = '<div><span>Bitcoin minado en 5 años</span><b>' + btc(c.btc5) + ' BTC</b></div>' +
            '<div><span>Valdría a ese precio</span><b>' + eur(value) + '</b></div>' +
            '<div><span>Lo que habrás gastado (inversión' + (r.maintenanceYear > 0 ? ', luz y mantenimiento' : ' y luz') + ')</span><b>' + eur(costs) + '</b></div>' +
            '<div><span>Resultado</span><b class="pill ' + (net >= 0 ? 'good' : 'bad') + '">' + signed(net) + '</b></div>';
        qsa('#wi-presets button').forEach(function(b) { b.classList.toggle('sel', Math.abs(parseFloat(b.getAttribute('data-k')) * c.price - p) < 600); });
    }

    function compareCard(c) {
        var comp = SolHash.compareMiningVsHodl(c.r, c.inputs), now = comp.costNow;
        if (!now) return '';
        var diff = (1 - now.total / comp.priceM0) * 100;
        var cheaper = diff >= 0;
        return '<article class="card"><h2>¿Minar o comprar Bitcoin?</h2>' +
            '<p class="what">Minar es como comprar Bitcoin a un precio fijo: tu coste de producción. Si te sale más barato que el precio de mercado, minar gana a comprar.</p>' +
            '<div class="compare"><div><span>Te cuesta producir 1 BTC hoy</span><b>' + eur(now.total) + '</b></div><span class="vs">frente a</span>' +
            '<div><span>Comprar 1 BTC hoy</span><b>' + eur(comp.priceM0) + '</b></div></div>' +
            '<p><span class="pill ' + (cheaper ? 'good' : 'bad') + '">' + num(Math.abs(diff)) + ' % ' + (cheaper ? 'más barato minando' : 'más caro minando') + '</span></p>' +
            '<div class="kvs one"><div><span>Luz y energía por BTC</span><b>' + eur(now.energy) + '</b></div>' +
            (now.maintenance > 0 ? '<div><span>Mantenimiento por BTC</span><b>' + eur(now.maintenance) + '</b></div>' : '') +
            '<div><span>Amortización del equipo por BTC</span><b>' + eur(now.amortization) + '</b></div></div>' +
            '<p class="what" style="margin:14px 0 0">Ese coste sube con el tiempo: la red se vuelve más difícil y en 2028 hay halving. Con el mismo dinero, en 5 años habrías minado ' + btc(comp.btcMined60) +
            ' BTC; comprando hoy tendrías ' + btc(comp.hodlBTC) + ' BTC.</p></article>';
    }

    function needsCard(c) {
        var r = c.r, kw = r.totalPowerKW;
        var noise = r.noiseDB >= 70 ? 'muy alto, como una aspiradora: mejor fuera de la vivienda' : r.noiseDB >= 55 ? 'moderado' : 'bajo';
        return '<article class="card"><h2>Lo que vas a necesitar</h2>' +
            '<p class="what">Las máquinas convierten toda la electricidad en calor y hacen ruido. Esto es lo que hay que preparar.</p>' +
            '<div class="kvs one">' +
            '<div><span>Potencia de las máquinas</span><b>' + num(kw, 1) + ' kW</b></div>' +
            '<div><span>Calor que desprenden</span><b>como ' + num(Math.max(1, Math.round(kw / 2))) + (Math.round(kw / 2) === 1 ? ' radiador' : ' radiadores') + ' de 2 kW</b></div>' +
            '<div><span>Ruido</span><b>' + num(r.noiseDB) + ' dB, ' + noise + '</b></div>' +
            '<div><span>Ventilación</span><b>' + num(r.airflowM3h) + ' m³/h · ' + r.fansNeeded + (r.fansNeeded === 1 ? ' extractor' : ' extractores') + '</b></div>' +
            '<div><span>Conexión eléctrica</span><b>' + esc(r.connectionType) + '</b></div>' +
            '<div><span>Potencia contratada mínima</span><b>' + num(r.contractedPower, 1) + ' kW</b></div>' +
            '<div><span>Protección y cable</span><b>' + r.breakerA + ' A · ' + r.cableSection + ' mm²</b></div>' +
            '</div></article>';
    }

    function budgetCard(c) {
        var r = c.r, ids;
        if (st.situacion === 'nueva') ids = ['bud-miners', 'bud-panels', 'bud-inverter', 'bud-mounting', 'bud-cabling', 'bud-labor', 'bud-permits'].concat(c.inputs.batteryOn ? ['bud-battery'] : []);
        else ids = ['bud-miners'];
        var vals = {
            'bud-miners': r.minersCost, 'bud-panels': r.solarPanelsCost, 'bud-inverter': r.inverterCost, 'bud-mounting': r.mountingCost,
            'bud-cabling': r.cablingCost, 'bud-labor': r.laborCost, 'bud-permits': r.permitsCost, 'bud-battery': r.batteryCost
        };
        var note = st.situacion === 'dedicada'
            ? '<p class="help">Incluye ' + eur(st.existCost) + ' de tu instalación actual' + (st.addKwp || st.addKwh ? ' y la ampliación a precio medio de mercado' : '') + '.</p>'
            : st.situacion === 'casa' ? '<p class="help">Tus placas ya están pagadas: solo cuentan las máquinas.</p>' : '';
        return '<article class="card budget"><h2>Tu presupuesto</h2>' +
            '<p class="what">Precios medios de mercado. Si ya tienes un presupuesto, cambia las cifras y el resultado se recalcula.</p>' +
            '<div class="budget-grid">' + ids.map(function(id) {
                return '<div class="field"><label for="b-' + id + '">' + BUDGET_LABELS[id] + '</label><div class="num"><input type="number" id="b-' + id + '" data-bud="' + id + '" min="0" step="50" value="' + Math.round(toCur(vals[id])) + '"><span>' + sym() + '</span></div></div>';
            }).join('') + '</div>' + note +
            '<div class="budget-total"><span>Inversión total</span><b>' + eur(r.totalInvestment) + '</b></div>' +
            (Object.keys(st.budget).length ? '<p style="margin:10px 0 0"><button type="button" class="link" id="bud-reset">Volver a los precios de mercado</button></p>' : '') +
            '</article>';
    }

    function materialsCard(c) {
        var d = designSolar(st.newKwp, st.newKwh);
        if (!d) return '';
        var m = c.inputs.miner, minersCost = c.r.minersCost, total = d.total + minersCost, vat = SOLAR_MATERIALS.vat;
        var rows = d.items.map(function(it) {
            return '<tr><td>' + it.n + '</td><td>' + esc(it.label) + '</td><td>' + eur(it.total) + '</td></tr>';
        }).join('') + '<tr><td>' + c.inputs.qty + '</td><td>' + esc(m.name) + '</td><td>' + eur(minersCost) + '</td></tr>';
        return '<article class="card full mat"><h2>Lo que necesitas montar</h2>' +
            '<p class="what">La lista de materiales de tu instalación, con precios de referencia sin IVA. Sirve para hacerte una idea y para pedir presupuesto.</p>' +
            '<div class="mat-opts"><div class="chips" data-mat="roof"><button type="button" data-val="tejado"' + (st.roof === 'tejado' ? ' class="sel"' : '') + '>Placas en tejado</button>' +
                '<button type="button" data-val="suelo"' + (st.roof === 'suelo' ? ' class="sel"' : '') + '>Placas en suelo</button></div>' +
                '<div class="chips" data-mat="installer"><button type="button" data-val="1"' + (st.installer ? ' class="sel"' : '') + '>Con instalador</button>' +
                '<button type="button" data-val="0"' + (!st.installer ? ' class="sel"' : '') + '>Lo monto yo</button></div></div>' +
            '<div class="table-wrap"><table class="months-t mat-t"><tr><th>Uds.</th><th>Material</th><th>Importe</th></tr>' + rows +
            '<tr class="tot"><td></td><td>Total sin IVA</td><td>' + eur(total) + '</td></tr>' +
            '<tr class="vat"><td></td><td>IVA (' + Math.round(vat * 100) + ' %), no incluido</td><td>+' + eur(total * vat) + '</td></tr></table></div>' +
            '<div class="kvs mat-kvs"><div><span>Potencia de las placas</span><b>' + num(d.kwp, 2) + ' kWp</b></div>' +
            '<div><span>Superficie que ocupan</span><b>unos ' + num(Math.ceil(d.area / 5) * 5) + ' m²</b></div>' +
            '<div><span>Conexión</span><b>' + (d.inverter.tri ? 'Trifásica' : 'Monofásica') + '</b></div>' +
            '<div><span>Batería</span><b>' + (d.modules ? d.modules + ' × ' + num(SOLAR_MATERIALS.battery.kwh, 2) + ' kWh' : 'Sin batería') + '</b></div></div>' +
            '<p class="help">Precios de referencia del ' + new Date(SOLAR_MATERIALS.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) +
            '. Las placas duran más de 25 años; en este cálculo solo cuentan los 10 primeros.</p></article>';
    }

    function advancedCard() {
        return '<article class="card"><h2>Ajustes finos</h2>' +
            '<p class="what">Valores que la mayoría puede dejar como están.</p>' +
            '<div class="field"><label for="a-mant">Mantenimiento por máquina y año (opcional)</label><div class="num"><input type="number" id="a-mant" min="0" step="10" data-adv="mant" data-money="0" value="' + Math.round(toCur(mantFor())) + '"><span>' + sym() + '</span></div><p class="help">Por defecto no se descuenta: solo cuenta la luz. ' +
                (mantFor() > 0 ? '<button type="button" class="link" id="mant-auto">Quitar el mantenimiento</button>' : 'Si quieres reservar algo para piezas o limpieza, ponlo aquí.') + '</p></div>' +
            (st.situacion !== 'red' ? '<div class="field"><label for="a-dod">Parte de la batería que se usa</label><div class="num"><input type="number" id="a-dod" min="40" max="100" step="5" data-adv="dod" value="' + st.dod + '"><span>%</span></div></div>' : '') +
            (st.situacion !== 'casa' && st.situacion !== 'red' ? '<div class="field"><label for="a-exc">Precio al que podrías vender tu sol a la red</label><div class="num"><input type="number" id="a-exc" min="0" step="0.005" data-adv="excedentes" data-money="4" value="' + Math.round(toCur(st.excedentes) * 10000) / 10000 + '"><span>' + sym() + '/kWh</span></div><p class="help">Pon 0 si tienes vertido cero.</p></div>' : '') +
            '</article>';
    }

    /** Lite: lo que añade la Pro, en lugar de los ajustes finos */
    function proCard() {
        return '<article class="card pro-card"><h2>¿Quieres afinar más? ' + proBadge() + '</h2>' +
            '<p class="what">Este cálculo es la versión gratuita. SolHash Pro añade:</p>' +
            '<ul class="pro-list">' +
                '<li>Subir tu factura de la luz en PDF o foto y que tu tarifa se rellene sola</li>' +
                '<li>Informe en PDF de tu proyecto para guardarlo o enseñarlo</li>' +
                '<li>Ajustes finos: mantenimiento, parte de la batería que se usa y precio de venta de tu sol</li>' +
                '<li>La versión completa, con escenarios de precio de Bitcoin y el optimizador automático</li>' +
            '</ul>' +
            '<a class="btn btn-sun" href="' + PRO_URL + '" target="_blank" rel="noopener">Ver SolHash Pro</a></article>';
    }

    function bindResult(c) {
        qsa('[data-edit]').forEach(function(b) { b.addEventListener('click', function() { st._from = 'resultado'; go(b.getAttribute('data-edit')); }); });
        $('edit-btn').addEventListener('click', function() { st._from = 'resultado'; go('situacion'); });
        var pdf = $('pdf-btn');
        if (pdf) pdf.addEventListener('click', function() {
            applyHSP();
            if (window.generarInforme) window.generarInforme(buildInputs());
        });
        var range = $('wi-range');
        if (range) {
            range.addEventListener('input', function() { st.btcTarget = parseFloat(range.value); save(); updateWhatIf(c); });
            qsa('#wi-presets button').forEach(function(b) {
                b.addEventListener('click', function() {
                    range.value = Math.round(c.price * parseFloat(b.getAttribute('data-k')));
                    st.btcTarget = parseFloat(range.value); save(); updateWhatIf(c);
                });
            });
            updateWhatIf(c);
        }
        var timer = null;
        function later(fn) { clearTimeout(timer); timer = setTimeout(fn, 450); }
        qsa('[data-bud]').forEach(function(el) {
            el.addEventListener('input', function() {
                var v = parseFloat(el.value);
                if (isNaN(v) || v < 0) return;
                st.budget[el.getAttribute('data-bud')] = fromCur(v); save();
                later(function() { keepFocus(el.id, renderResult); });
            });
        });
        qsa('[data-adv]').forEach(function(el) {
            el.addEventListener('input', function() {
                var v = parseFloat(el.value);
                if (isNaN(v) || v < 0) return;
                st[el.getAttribute('data-adv')] = el.getAttribute('data-money') !== null ? fromCur(v) : v; save();
                later(function() { keepFocus(el.id, renderResult); });
            });
        });
        qsa('[data-mat]').forEach(function(g) {
            g.addEventListener('click', function(e) {
                var b = e.target.closest('button');
                if (!b) return;
                var k = g.getAttribute('data-mat'), v = b.getAttribute('data-val');
                st[k] = k === 'installer' ? v === '1' : v;
                save();
                keepFocus(null, renderResult);
            });
        });
        var ma = $('mant-auto');
        if (ma) ma.addEventListener('click', function() { st.mant = null; save(); renderResult(); });
        var reset = $('bud-reset');
        if (reset) reset.addEventListener('click', function() { st.budget = {}; save(); renderResult(); });
    }
    function keepFocus(id, fn) {
        var y = window.scrollY;
        fn();
        window.scrollTo(0, y);
        var el = $(id);
        if (el) { el.focus(); var n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
    }

    function waLink(c) {
        var i = c.inputs, sit = SITUATIONS[st.situacion];
        var t = 'Hola Marcos, he calculado mi proyecto con SolHash ' + (LITE ? 'Lite' : 'Pro') + ':\n' +
            '• ' + sit + (st.situacion === 'red' ? '' : ' (' + (st.hsp ? st.lugar : (ZONES[st.zona] || ZONES.centro).label) + ')') + '\n' +
            (st.situacion === 'nueva' ? '• Placas: ' + num(i.solarKWp, 2) + ' kWp' + (i.batteryKWh ? ' + batería ' + num(i.batteryKWh, 1) + ' kWh' : '') + '\n' : '') +
            '• ' + i.qty + ' × ' + i.miner.name + '\n' +
            '• Inversión: ' + eur(c.r.totalInvestment) + '\n' +
            '• Primer año: ' + eur(c.year1) + (c.payback !== null ? ' · recupero en ' + months(c.payback) : '') + '\n' +
            '¿Me ayudas a ponerlo en marcha?';
        return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(t);
    }

    // ─── Datos en vivo ─────────────────────────────────────────────────────

    function loadLive() {
        // Primero el puente en Vercel (funciona con Cloudflare bloqueado); si no existe, el Worker
        fetchJSON('/api/network', 20000).then(function(d) {
            if (!d || !d.ok) throw new Error('sin datos');
            return d;
        }).catch(function() { return fetchJSON(WORKER + '/network', 12000); }).then(function(d) {
            if (!d || !d.ok || !d.coins || !d.coins.BTC) return;
            SolHash.setBTCPrice(d.coins.BTC.priceEUR);
            // Hashrate equivalente a la dificultad (WhatToMine lo estima con el tiempo real entre bloques,
            // que oscila mucho; el motor cuenta 144 bloques al día, así que se normaliza a 600 s)
            var bt = d.coins.BTC.blockTime > 0 ? d.coins.BTC.blockTime : 600;
            SolHash.setNetworkHashrate(d.coins.BTC.nethash * bt / 600 / 1e18);
            if (window.SolHashCatalog) SolHashCatalog.setRate(d.usdToEur);
            if (d.usdToEur > 0) usdPerEur = 1 / d.usdToEur;
            syncControls();
            showLive(true);
            if (st.step === 'resultado') renderResult();
            else if (st.step === 'maquinas') renderMachines();
            else if (st.step === 'presupuesto') renderGuide();
        }).catch(function() { showLive(false); });
    }
    function showLive(on) {
        $('live').classList.toggle('on', !!on);
        $('live-price').textContent = 'BTC ' + eur(SolHash.BTC_PRICE);
        $('live').title = on ? 'Precio de Bitcoin y dificultad de la red de hoy' : 'Sin conexión: datos de respaldo';
    }

    // ─── Inicio ────────────────────────────────────────────────────────────

    // catalog-sync llama a recalculate() cuando cambia el tipo de cambio
    window.recalculate = function() {
        if (st.step === 'resultado') renderResult();
        else if (st.step === 'maquinas') renderPicked();
    };

    document.addEventListener('DOMContentLoaded', function() {
        if (!window.SolHash) return;
        bindWizard();
        syncControls();
        showPlace();
        showBill();
        showLive(false);
        go(st.step || 'situacion');
        loadLive();
    });
})();
