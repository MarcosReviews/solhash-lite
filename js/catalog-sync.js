/**
 * Catálogo único de mineros.
 * El modo Solar usaba una lista escrita a mano en engine.js con precios antiguos.
 * Este módulo la sustituye por los equipos de Bitcoin de js/machines-data.js
 * (lista de proveedor más reciente + margen), que es también lo que usan
 * el modo "Solo máquina" y la Lite. Actualizar precios = regenerar machines-data.js.
 *
 * Debe cargarse después de machines-data.js y engine.js, y antes de app.js.
 */
var SolHashCatalog = (function() {
    'use strict';

    var FALLBACK_USD_TO_EUR = 0.897;
    var DEFAULT_NAME = 'antminer s21 pro+ 234';
    // Claves del catálogo antiguo (proyectos guardados, ejemplo) → modelo equivalente de la lista
    var LEGACY = {
        s19kpro: 'antminer s19k pro 120', s19xp: 'antminer s19 xp 141', s19pro: 'antminer s19 pro 110',
        s19jpro: 'antminer s19j pro+ 120', s21: 'antminer s21++ 216', s21plus: 'antminer s21++ 216',
        s21pro: 'antminer s21 pro+ 234', s21xp: 'antminer s21 xp 270', m66splus: 'whatsminer m66s+ 318',
        m60s: 'whatsminer m60s++ 226', m63s: 'whatsminer m63s 408', sealminer: 'bitdeer a2 pro 260'
    };

    var rate = FALLBACK_USD_TO_EUR;
    var source = (window.MACHINES_DATA && MACHINES_DATA.machines || []).filter(function(m) { return m.coin === 'BTC'; });
    var enabled = source.length > 0 && window.SolHash && SolHash.MINERS;

    function isReady(m) { return !m.delivery || m.delivery.type === 'ready'; }

    function toMiner(m) {
        return {
            name: m.name,
            hashrate: m.hashrate,
            powerKW: Math.round(m.powerW) / 1000,
            efficiency: Math.round(m.powerW / m.hashrate * 10) / 10,
            noise: m.cooling === 'aire' ? 75 : 50,
            price: Math.round(m.priceUSD * rate),
            priceUSD: m.priceUSD,
            cooling: m.cooling,
            ready: isReady(m),
            delivery: m.delivery ? m.delivery.label : ''
        };
    }

    function fill() {
        var M = SolHash.MINERS, custom = M.custom;
        for (var k in M) delete M[k];
        for (var i = 0; i < source.length; i++) M[source[i].id] = toMiner(source[i]);
        if (custom) M.custom = custom;
    }

    function findByName(prefix) {
        var M = SolHash.MINERS, fallback = null;
        for (var k in M) {
            if (k === 'custom' || M[k].name.toLowerCase().indexOf(prefix) !== 0) continue;
            if (M[k].ready) return k;
            fallback = fallback || k;
        }
        return fallback;
    }

    /** Devuelve una clave válida del catálogo actual para una clave nueva, antigua o desconocida */
    function resolve(key) {
        if (!enabled) return key;
        if (key && SolHash.MINERS[key]) return key;
        return (LEGACY[key] && findByName(LEGACY[key])) || findByName(DEFAULT_NAME) || Object.keys(SolHash.MINERS)[0];
    }

    function buildSelect() {
        var sel = document.getElementById('miner-select');
        if (!sel) return;
        var groups = [
            ['Aire, en stock', function(m) { return m.cooling === 'aire' && m.ready; }],
            ['Aire, bajo pedido', function(m) { return m.cooling === 'aire' && !m.ready; }],
            ['Refrigeración líquida (hidro)', function(m) { return m.cooling === 'hidro'; }],
            ['Inmersión', function(m) { return m.cooling !== 'aire' && m.cooling !== 'hidro'; }]
        ];
        var customGroup = null, old = sel.querySelectorAll('optgroup');
        for (var i = 0; i < old.length; i++) {
            if (old[i].querySelector('option[value="custom"]')) customGroup = old[i];
            else sel.removeChild(old[i]);
        }
        var M = SolHash.MINERS;
        groups.forEach(function(g) {
            var og = document.createElement('optgroup');
            og.label = g[0];
            for (var k in M) {
                if (k === 'custom' || !g[1](M[k])) continue;
                var o = document.createElement('option');
                o.value = k;
                o.textContent = M[k].name + (M[k].ready ? '' : ' — ' + M[k].delivery);
                og.appendChild(o);
            }
            if (og.children.length) sel.insertBefore(og, customGroup);
        });
        sel.value = resolve(null);

        // Fecha de la lista de precios, a la vista
        var specs = sel.parentNode.querySelector('.miner-specs');
        if (specs && MACHINES_DATA.fecha && !document.getElementById('miner-list-date')) {
            var note = document.createElement('div');
            note.id = 'miner-list-date';
            note.className = 'miner-list-date';
            note.textContent = 'Precios actualizados el ' +
                new Date(MACHINES_DATA.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
            specs.parentNode.insertBefore(note, specs.nextSibling);
        }
    }

    /** Cambio USD→EUR del día: actualiza los precios en euros sin tocar la selección */
    function setRate(usdToEur) {
        if (!enabled || !(usdToEur > 0) || Math.abs(usdToEur - rate) < 0.0005) return;
        rate = usdToEur;
        var M = SolHash.MINERS;
        for (var k in M) if (M[k].priceUSD) M[k].price = Math.round(M[k].priceUSD * rate);
        if (window.recalculate) window.recalculate();
    }

    if (enabled) {
        fill();
        buildSelect();
        document.addEventListener('DOMContentLoaded', function() {
            if (window.MachineMode && MachineMode.onNetwork) {
                MachineMode.onNetwork(function() { setRate(MachineMode.usdToEur()); });
            }
        });
    }

    return {
        resolve: resolve,
        setRate: setRate,
        listDate: function() { return window.MACHINES_DATA ? MACHINES_DATA.fecha : null; }
    };
})();
