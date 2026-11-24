/**
 * SolHash Simple — interfaz guiada para principiantes.
 * 4 preguntas → recomendación de equipo con el motor de MachineMode (js/machine-mode.js)
 * y el catálogo de venta (js/machines-data.js). Página pública, sin licencia.
 */
(function() {
    'use strict';

    var WHATSAPP = '34623056949';
    var EVENT_URL = 'https://solhash-license.reviewsmarcos.workers.dev/event';
    var PRO_URL = 'https://www.startminingnow.es/solhash';
    var ORDER = ['intro', 'zona', 'luz', 'dinero', 'lugar', 'resultado'];
    var TYPICAL_PRICE = { EUR: 0.15, USD: 0.12 };
    var BUDGETS = [500, 1000, 2000, 3000, 5000, 10000];
    var HORIZON = 36;
    var PLACES = {
        casa:   { label: 'en casa', maxUnitW: 1700, maxTotalW: 1800 },
        garaje: { label: 'en un garaje, trastero o local', maxUnitW: 4000, maxTotalW: 7500 },
        nave:   { label: 'en una nave o instalación propia', maxUnitW: null, maxTotalW: 60000 }
    };
    var COIN_TEXT = { 'BTC': 'Bitcoin', 'ZEC': 'Zcash', 'LTC+DOGE': 'Litecoin y Dogecoin' };

    var answers = { zona: null, luz: null, precio: null, solar: false, dinero: null, lugar: null };
    var current = 'intro';

    function $(id) { return document.getElementById(id); }
    function cur() { return answers.zona === 'latam' ? 'USD' : 'EUR'; }
    function sym() { return cur() === 'USD' ? '$' : '€'; }

    // ─── Embudo (contadores anónimos: sin cookies ni datos personales) ─────
    // Cada hito se cuenta una vez por visita y se envía agrupado para gastar pocas escrituras.
    var seen = {}, pending = [];
    function track(name) {
        if (seen[name]) return;
        seen[name] = true;
        pending.push(name);
    }
    function flush() {
        if (!pending.length || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { pending = []; return; }
        var body = JSON.stringify({ e: pending });
        pending = [];
        try {
            if (navigator.sendBeacon) navigator.sendBeacon(EVENT_URL, body);
            else fetch(EVENT_URL, { method: 'POST', body: body, keepalive: true });
        } catch (e) {}
    }
    track('visit');
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);

    // ─── Navegación ────────────────────────────────────────────────────────

    function go(name) {
        current = name;
        var screens = document.querySelectorAll('.screen');
        for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('is-active', screens[i].getAttribute('data-screen') === name);
        var step = ORDER.indexOf(name);
        var dots = $('dots').children;
        $('dots').classList.toggle('on', step >= 1 && step <= 4);
        for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('done', d < step);
        $('back').hidden = name === 'intro';
        if (name === 'dinero') renderChips();
        if (name === 'resultado') renderResult();
        var units = document.querySelectorAll('.cur');
        for (var u = 0; u < units.length; u++) units[u].textContent = sym();
        window.scrollTo(0, 0);
    }
    function next() { go(ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(current) + 1)]); }
    function back() { go(ORDER[Math.max(0, ORDER.indexOf(current) - 1)]); }

    document.addEventListener('click', function(e) {
        if (e.target.closest('[data-next]')) { track('start'); next(); return; }
        if (e.target.closest('.btn-wa')) { track('whatsapp'); flush(); return; }
        if (e.target.closest('[data-restart]')) { go('zona'); return; }

        var choice = e.target.closest('.choice');
        if (choice) {
            var key = choice.getAttribute('data-set');
            answers[key] = choice.getAttribute('data-val');
            var sibs = choice.parentNode.querySelectorAll('.choice');
            for (var i = 0; i < sibs.length; i++) sibs[i].classList.toggle('sel', sibs[i] === choice);
            if (key === 'luz') {
                var knows = answers.luz === 'se';
                $('precio-box').hidden = !knows;
                if (!knows) track('q2');
                if (knows) { $('precio-kwh').placeholder = String(TYPICAL_PRICE[cur()]).replace('.', ','); $('precio-kwh').focus(); return; }
            }
            if (key === 'zona') track('q1');
            if (key === 'lugar') track('q4');
            setTimeout(next, 180);
            return;
        }

        var chip = e.target.closest('.chip');
        if (chip) { answers.dinero = parseFloat(chip.getAttribute('data-val')); track('q3'); next(); }
    });

    $('back').addEventListener('click', back);
    $('solar').addEventListener('change', function() { answers.solar = this.checked; });

    function submitPrecio() {
        var v = parseFloat(String($('precio-kwh').value).replace(',', '.'));
        if (isNaN(v) || v < 0 || v > 2) { $('precio-kwh').focus(); return; }
        answers.precio = v;
        track('q2');
        next();
    }
    function submitOtro() {
        var v = parseFloat($('otro').value);
        if (isNaN(v) || v < 100) { $('otro').focus(); return; }
        answers.dinero = v;
        track('q3');
        next();
    }
    $('precio-ok').addEventListener('click', submitPrecio);
    $('otro-ok').addEventListener('click', submitOtro);
    $('precio-kwh').addEventListener('keydown', function(e) { if (e.key === 'Enter') submitPrecio(); });
    $('otro').addEventListener('keydown', function(e) { if (e.key === 'Enter') submitOtro(); });

    function renderChips() {
        var html = '';
        for (var i = 0; i < BUDGETS.length; i++) {
            html += '<button type="button" class="chip" data-val="' + BUDGETS[i] + '">' + money(BUDGETS[i]) + '</button>';
        }
        $('chips').innerHTML = html;
    }

    // ─── Cálculo ───────────────────────────────────────────────────────────

    function query(budget) {
        var place = PLACES[answers.lugar] || PLACES.garaje;
        return {
            currency: cur(),
            freePower: answers.luz === 'gratis',
            elecPrice: answers.luz === 'se' ? answers.precio : TYPICAL_PRICE[cur()],
            budget: budget,
            maxUnitW: place.maxUnitW,
            maxTotalW: place.maxTotalW,
            coolings: ['aire']
        };
    }
    function isGood(r) { return r.roiMonth !== null && r.net36 > 0; }
    function sameOffer(a, b) { return a && b && a.machine.id === b.machine.id && a.qty === b.qty; }

    function pick() {
        var all = MachineMode.quote(query(answers.dinero));
        var good = all.filter(isGood);
        var res = { all: all, best: null, fast: null, small: null };
        if (!good.length) return res;

        res.best = good.slice().sort(function(a, b) { return b.net36 - a.net36; })[0];
        var fast = good.slice().sort(function(a, b) { return a.roiMonth - b.roiMonth; })[0];
        if (!sameOffer(fast, res.best)) res.fast = fast;

        // Para empezar con poco: una sola unidad, la más barata que sea rentable
        var singles = MachineMode.quote(query(null)).filter(function(r) {
            return isGood(r) && r.invest <= answers.dinero && r.invest < res.best.invest * 0.7;
        }).sort(function(a, b) { return a.invest - b.invest; });
        if (singles.length && !sameOffer(singles[0], res.fast)) res.small = singles[0];
        return res;
    }

    // ─── Resultado ─────────────────────────────────────────────────────────

    function renderResult() {
        var box = $('resultado');
        var res = pick();
        var info = MachineMode.networkInfo();
        $('net-info').textContent = info.live ? 'Datos de red de hoy' : 'Datos de red del ' +
            new Date(info.updatedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

        if (res.best) { box.innerHTML = goodHTML(res); track('result_good'); }
        else if (res.all.length) {
            box.innerHTML = notProfitableHTML(res.all);
            track(res.all.some(function(r) { return r.monthlyProfit > 0; }) ? 'result_slow' : 'result_bad');
        }
        else { box.innerHTML = noFitHTML(); track('result_nofit'); }
        flush();

        var big = box.querySelector('[data-count]');
        if (big) countUp(big, parseFloat(big.getAttribute('data-count')));
        var line = box.querySelector('.chart .line');
        if (line && line.getTotalLength) line.style.setProperty('--len', Math.ceil(line.getTotalLength()));
    }

    function offerTitle(r) { return (r.qty > 1 ? r.qty + ' × ' : '') + MachineMode.displayName(r.machine); }

    function goodHTML(res) {
        var r = res.best;
        var free = answers.luz === 'gratis';
        var html = '<div class="r-head"><p class="kicker">Tu resultado</p><h2>Sí, te puede salir rentable</h2></div>';

        html += '<div class="card hero-card">' +
            '<span class="tag">Recomendada para ti</span>' +
            '<p class="m-name">' + esc(offerTitle(r)) + '</p>' +
            '<p class="m-sub">Mina ' + COIN_TEXT[r.machine.coin] + ' las 24 horas</p>' +
            '<p class="big"><span data-count="' + Math.round(r.monthlyProfit) + '">0</span> ' + sym() + '<small> / mes</small></p>' +
            '<p class="big-sub">de beneficio limpio' + (free ? '' : ', después de pagar la luz') + '</p>' +
            (free
                ? '<div class="eq"><span>Como no pagas la luz, todo lo que genera la máquina es para ti.</span></div>'
                : '<div class="eq"><span>Genera</span><b>' + money(r.monthlyRevenue) + '</b>' +
                  '<i class="op">−</i><span>Luz</span><b>' + money(r.monthlyElec) + '</b>' +
                  '<i class="op">=</i><span>Te quedan</span><b>' + money(r.monthlyProfit) + ' al mes</b></div>') +
        '</div>';

        html += '<div class="stats">' +
            stat('Cuesta', money(r.invest)) +
            stat('La recuperas en', months(r.roiMonth)) +
            stat('Ganancia en 3 años', money(r.net36)) +
        '</div>';

        html += '<div class="card"><h3>Así evoluciona tu dinero</h3>' +
            '<p class="sub">Empiezas en negativo porque pagas la máquina. Cuando la línea cruza la raya, ya la has recuperado.</p>' +
            chartSVG(r) + '</div>';

        html += '<div class="card"><h3>Lo que debes saber</h3><ul class="notes">' + notesHTML(r) + '</ul></div>';

        var alts = '';
        if (res.fast) alts += altHTML(res.fast, 'Recuperas antes');
        if (res.small) alts += altHTML(res.small, 'Para empezar con poco');
        if (alts) html += '<div class="alts">' + alts + '</div>';

        html += '<div class="card cta"><h3>¿Quieres empezar?</h3>' +
            '<p>Escríbeme por WhatsApp con tu caso ya preparado. Te confirmo precio, envío y cómo ponerla en marcha.</p>' +
            '<a class="btn-main btn-wa" target="_blank" rel="noopener" href="' + waLink(r) + '">Hablar con Marcos por WhatsApp</a><br>' +
            '<button type="button" class="btn-ghost" data-restart>Cambiar mis respuestas</button></div>';

        return html + proHTML() + faqHTML();
    }

    function notesHTML(r) {
        var n = [];
        if (r.startMonth > 0.5) n.push(['📦', esc(r.machine.delivery.label) + '. Hasta que no llega no produce; ya está descontado en los números.']);
        for (var i = 0; i < r.halvings.length; i++) {
            var h = r.halvings[i];
            if (h.month > HORIZON) continue;
            n.push(['⚡', 'Hacia ' + h.date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) + ' lo que genera de ' +
                MachineMode.coinNames[h.coin] + ' baja a la mitad (se llama <i>halving</i>). Ya está incluido.']);
        }
        if (answers.luz === 'nose') n.push(['💡', 'He usado un precio de luz típico (' + price(TYPICAL_PRICE[cur()]) + '/kWh). Mientras pagues menos de ' +
            price(r.maxElecPrice) + '/kWh, sigue dando beneficio.']);
        if (answers.solar) n.push(['☀️', 'Con placas solares tu luz de día sale mucho más barata y el resultado mejora. Te hago el estudio a medida.']);
        if (answers.lugar === 'casa') n.push(['🏠', 'Es un equipo doméstico: silencioso y de enchufe normal.']);
        else n.push(['🔊', 'Hace ruido y da calor, parecido a un aire acondicionado industrial. Necesita ventilación' +
            (r.kw > 3.4 ? ' y una toma eléctrica de ' + num(r.kw, 1) + ' kW.' : '.')]);
        n.push(['📉', 'Son números a precios de hoy. Si la moneda sube ganarás más; si baja, menos. Nadie puede garantizar el precio.']);
        return n.map(function(x) { return '<li><span>' + x[0] + '</span><span>' + x[1] + '</span></li>'; }).join('');
    }

    function altHTML(r, label) {
        return '<div class="alt"><span class="tag soft">' + label + '</span>' +
            '<p class="m-name">' + esc(offerTitle(r)) + '</p>' +
            '<p><b>' + money(r.monthlyProfit) + ' al mes</b> · cuesta ' + money(r.invest) + ' · la recuperas en ' + months(r.roiMonth) + '</p></div>';
    }

    function notProfitableHTML(all) {
        var best = all.slice().sort(function(a, b) { return b.maxElecPrice - a.maxElecPrice; })[0];
        var used = answers.luz === 'se' ? answers.precio : TYPICAL_PRICE[cur()];
        var ending = '<div class="card cta"><h3>Cuéntame tu caso</h3><p>Muchas veces hay solución. Escríbeme y vemos qué opción te encaja.</p>' +
            '<a class="btn-main btn-wa" target="_blank" rel="noopener" href="' + waLink(null) + '">Hablar con Marcos por WhatsApp</a><br>' +
            '<button type="button" class="btn-ghost" data-restart>Cambiar mis respuestas</button></div>' + proHTML() + faqHTML();

        // Caso intermedio: da beneficio cada mes, pero no llega a devolver lo que cuesta en 3 años
        var earning = all.filter(function(r) { return r.monthlyProfit > 0; }).sort(function(a, b) { return b.net36 - a.net36; })[0];
        if (earning) {
            return '<div class="r-head"><p class="kicker">Tu resultado</p><h2>Da beneficio, pero no recuperas la máquina</h2></div>' +
                '<div class="card"><h3>Te lo explico sin rodeos</h3><ul class="notes">' +
                '<li><span>⛏️</span><span>La mejor opción sería <b>' + esc(offerTitle(earning)) + '</b>: al principio te dejaría unos <b>' +
                    money(earning.monthlyProfit) + ' al mes</b> después de pagar la luz.</span></li>' +
                '<li><span>⏳</span><span>El problema es que cuesta <b>' + money(earning.invest) + '</b> y ' +
                    (earning.profit36 > 0
                        ? 'en 3 años solo recuperarías <b class="bad-num">' + money(earning.profit36) + '</b>.'
                        : 'ese beneficio no dura: en pocos meses gastaría en luz más de lo que genera.') +
                    ' Cada año la red se vuelve más exigente y la máquina produce menos.</span></li>' +
                '<li><span>💡</span><span>Con la luz a ' + price(used) + '/kWh el margen es demasiado justo. Con luz más barata o gratis, los números cambian mucho.</span></li>' +
                '</ul></div>' + ending;
        }
        return '<div class="r-head"><p class="kicker">Tu resultado</p><h2>Con tu precio de luz, hoy no te sale rentable</h2></div>' +
            '<div class="card"><h3>Te lo explico sin rodeos</h3><ul class="notes">' +
            '<li><span>💡</span><span>Con la luz a <b>' + price(used) + '/kWh</b>' + (answers.luz === 'nose' ? ' (precio típico, porque no sabes el tuyo)' : '') +
                ', las máquinas que encajan gastan en electricidad más de lo que generan.</span></li>' +
            '<li><span>🎯</span><span>La que más aguanta es la <b>' + esc(best.machine.name) + '</b>: da beneficio si pagas menos de <b class="bad-num">' +
                price(best.maxElecPrice) + '/kWh</b>.</span></li>' +
            '<li><span>☀️</span><span>Hay formas de conseguirlo: placas solares, una tarifa con horas baratas o alojar la máquina en una granja con luz barata.</span></li>' +
            '</ul></div>' + ending;
    }

    function noFitHTML() {
        var q = query(null);
        var singles = MachineMode.quote(q).sort(function(a, b) { return a.invest - b.invest; });
        var cheapest = singles[0];
        return '<div class="r-head"><p class="kicker">Tu resultado</p><h2>Con ' + money(answers.dinero) + ' no llega para una máquina</h2></div>' +
            '<div class="card"><ul class="notes"><li><span>💶</span><span>' +
            (cheapest ? 'La más barata que puedes poner ' + (PLACES[answers.lugar] || PLACES.garaje).label + ' cuesta <b>' + money(cheapest.invest) + '</b> (' + esc(cheapest.machine.name) + ').'
                      : 'Ahora mismo no tengo ninguna máquina que encaje con ese sitio.') +
            '</span></li></ul></div>' +
            '<div class="card cta"><a class="btn-main" href="#" data-restart>Probar con otra cantidad</a></div>';
    }

    function proHTML() {
        return '<div class="card pro"><div><h3>¿Quieres el estudio completo?</h3>' +
            '<p>SolHash Pro calcula tu caso con placas solares, baterías y tarifas por horas, compara minar con comprar y te da un informe en PDF.</p></div>' +
            '<a class="btn-ghost" target="_blank" rel="noopener" href="' + PRO_URL + '">Ver SolHash Pro</a></div>';
    }

    function faqHTML() {
        var fecha = window.MACHINES_DATA ? new Date(MACHINES_DATA.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        return '<div class="card"><h3>Preguntas frecuentes</h3>' +
            faq('¿Qué es minar?', 'Es tener una máquina encendida que ayuda a que funcione una red como Bitcoin. A cambio, la red te paga cada día una pequeña cantidad de esa moneda, que puedes guardar o cambiar por euros o dólares.') +
            faq('¿Tengo que saber de informática?', 'No. La máquina se enchufa a la luz y a internet, se configura una vez y trabaja sola. Yo te ayudo con la puesta en marcha.') +
            faq('¿Qué pasa si baja el precio de la moneda?', 'Ganas menos mientras esté baja, y más si sube. Por eso conviene tener la luz barata: es lo que te da margen cuando el precio cae.') +
            faq('¿De dónde salen estos números?', 'Del precio de la moneda y la dificultad de la red de hoy, y de los precios de máquinas de nuestro proveedor' +
                (fecha ? ' (lista del ' + fecha + ')' : '') + '. El cálculo descuenta un 2 % de comisión del pool, un 3 % de paradas y que la red se vuelve más exigente cada año.') +
            faq('¿Cuánto dura una máquina?', 'Varios años si está bien ventilada y limpia. Con el tiempo salen modelos más eficientes y la red se vuelve más exigente; esa pérdida progresiva ya está incluida en los cálculos.') +
        '</div>';
    }
    function faq(q, a) { return '<details><summary>' + q + '</summary><p>' + a + '</p></details>'; }
    function stat(label, value) { return '<div class="stat"><span>' + label + '</span><b>' + value + '</b></div>'; }

    // Gráfica de dinero acumulado (SVG propio, sin librerías)
    function chartSVG(r) {
        var W = 640, H = 230, L = 8, R = 8, T = 28, B = 26;
        var pts = [-r.invest];
        for (var i = 0; i < HORIZON; i++) pts.push(r.months[i].cum);
        var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts.concat([0]));
        var span = (max - min) || 1;
        function x(i) { return L + (W - L - R) * i / HORIZON; }
        function y(v) { return T + (H - T - B) * (1 - (v - min) / span); }
        var d = '';
        for (var k = 0; k < pts.length; k++) d += (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(pts[k]).toFixed(1);
        var area = d + 'L' + x(HORIZON).toFixed(1) + ' ' + (H - B) + 'L' + x(0).toFixed(1) + ' ' + (H - B) + 'Z';
        var y0 = y(0).toFixed(1);
        var roi = r.roiMonth !== null && r.roiMonth <= HORIZON ? r.roiMonth : null;
        var anchor = roi !== null && roi > HORIZON * 0.7 ? 'end' : 'start';
        return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Evolución del dinero acumulado en 3 años">' +
            '<defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a00" stop-opacity=".35"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/></linearGradient></defs>' +
            '<path class="area" d="' + area + '"/>' +
            '<line class="zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + y0 + '" y2="' + y0 + '"/>' +
            '<path class="line" d="' + d + '"/>' +
            (roi !== null ? '<circle class="roi-dot" cx="' + x(roi).toFixed(1) + '" cy="' + y0 + '" r="6"/>' +
                '<text class="roi-txt" text-anchor="' + anchor + '" x="' + (x(roi) + (anchor === 'end' ? -12 : 12)).toFixed(1) + '" y="' + (parseFloat(y0) + 22) + '">Mes ' + Math.ceil(roi) + ': máquina recuperada</text>' : '') +
            '<text x="' + L + '" y="' + (H - 6) + '">Hoy</text>' +
            '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle">1 año y medio</text>' +
            '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">3 años</text>' +
            '</svg>';
    }

    function waLink(r) {
        var zona = answers.zona === 'latam' ? 'Latinoamérica' : 'España/Europa';
        var luz = answers.luz === 'gratis' ? 'gratis' : answers.luz === 'se' ? price(answers.precio) + '/kWh' : 'no sé el precio';
        var t = 'Hola Marcos, he usado SolHash y quiero empezar a minar.\n' +
            '• Zona: ' + zona + '\n' +
            '• Luz: ' + luz + (answers.solar ? ' (tengo placas solares)' : '') + '\n' +
            '• Presupuesto: ' + money(answers.dinero) + '\n' +
            '• La pondría ' + (PLACES[answers.lugar] || PLACES.garaje).label + '\n';
        t += r ? '• SolHash me recomienda: ' + offerTitle(r) + ' (' + money(r.monthlyProfit) + '/mes aprox.)\n¿Me ayudas a empezar?'
               : 'SolHash me dice que con mi luz no sale rentable. ¿Qué opciones tengo?';
        return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(t);
    }

    // ─── Formato ───────────────────────────────────────────────────────────

    function num(n, d) {
        var s = Math.abs(n || 0).toFixed(d).split('.');
        var int = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return ((n || 0) < 0 && Number(s.join('.')) !== 0 ? '-' : '') + int + (d > 0 ? ',' + s[1] : '');
    }
    function money(n) { return num(Math.round(n), 0) + ' ' + sym(); }
    function price(n) { return num(n, n < 0.1 ? 3 : 2) + ' ' + sym(); }
    function months(m) {
        var n = Math.ceil(m);
        return n < 24 ? n + (n === 1 ? ' mes' : ' meses') : num(m / 12, 1) + ' años';
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function countUp(el, target) {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = num(target, 0); return; }
        var t0 = null, dur = 1100;
        function frame(t) {
            if (t0 === null) t0 = t;
            var p = Math.min(1, (t - t0) / dur);
            el.textContent = num(target * (1 - Math.pow(1 - p, 3)), 0);
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    // Portada: cada moneda que llega hace "latir" el monedero
    function startScene() {
        var svg = $('scene-svg'), wallet = $('scene-wallet'), plus = $('scene-plus');
        if (!svg || !wallet) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            if (svg.pauseAnimations) svg.pauseAnimations();
            return;
        }
        setInterval(function() {
            if (current !== 'intro' || document.hidden) return;
            wallet.classList.remove('hit'); plus.classList.remove('show');
            void wallet.getBoundingClientRect();   // reinicia la animación
            wallet.classList.add('hit'); plus.classList.add('show');
        }, 900);
    }

    // Si llegan datos de red en vivo mientras se ve el resultado, se recalcula
    document.addEventListener('DOMContentLoaded', function() {
        startScene();
        if (window.MachineMode) MachineMode.onNetwork(function() { if (current === 'resultado') renderResult(); });
    });
})();
