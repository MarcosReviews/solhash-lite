/**
 * Función de Vercel: horas de sol útil por mes (PVGIS, Comisión Europea) para un punto.
 *
 *   GET /api/pvgis?lat=38.78&lon=-6.24      (punto pinchado en el mapa)
 *   GET /api/pvgis?q=Alange, Badajoz        (municipio: se geolocaliza con OpenStreetMap)
 *   →  { ok, lat, lon, place, hsp: [12 valores kWh/m²·día en plano inclinado óptimo] }
 *
 * Existe porque la API de PVGIS no admite llamadas directas desde el navegador (sin CORS)
 * y porque vive en Vercel, fuera de Cloudflare: sigue funcionando cuando en España se
 * bloquean las IP de Cloudflare durante los partidos.
 */
const UA = 'SolHash/1.0 (calculadora de mineria solar; startminingnow.es)';

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = String((req.query && req.query.q) || '').trim().slice(0, 120);
    let lat = parseFloat(req.query && req.query.lat);
    let lon = parseFloat(req.query && req.query.lon);
    let place = null;

    try {
        if (!isFinite(lat) || !isFinite(lon)) {
            if (q.length < 2) return res.status(400).json({ ok: false, message: 'Indica un municipio o un punto del mapa' });
            const query = /espa|spain|portugal/i.test(q) ? q : q + ', España';
            const g = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query), { headers: { 'User-Agent': UA } });
            const geo = g.ok ? await g.json() : [];
            if (!geo.length) return res.status(404).json({ ok: false, message: 'No encuentro ese municipio' });
            lat = parseFloat(geo[0].lat);
            lon = parseFloat(geo[0].lon);
            place = geo[0].display_name;
        }
        if (Math.abs(lat) > 70 || Math.abs(lon) > 180) return res.status(400).json({ ok: false, message: 'Punto fuera de cobertura' });

        // Inclinación y orientación óptimas; H(i)_d = irradiación diaria en el plano de los paneles ≈ horas de sol pico
        const url = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4) +
            '&peakpower=1&loss=14&optimalangles=1&outputformat=json';
        const p = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!p.ok) return res.status(502).json({ ok: false, message: p.status === 400 ? 'PVGIS no tiene datos de ese punto (¿es mar?)' : 'PVGIS no responde' });
        const pv = await p.json();
        const monthly = pv && pv.outputs && pv.outputs.monthly && pv.outputs.monthly.fixed;
        if (!monthly || monthly.length !== 12) return res.status(502).json({ ok: false, message: 'PVGIS sin datos mensuales' });
        const hsp = monthly.slice().sort((a, b) => a.month - b.month).map(m => Math.round(m['H(i)_d'] * 100) / 100);
        const angle = pv.inputs && pv.inputs.mounting_system && pv.inputs.mounting_system.fixed && pv.inputs.mounting_system.fixed.slope;

        res.setHeader('Cache-Control', 'public, s-maxage=2592000, max-age=86400');
        return res.status(200).json({ ok: true, lat, lon, place, hsp, angle: angle ? angle.value : null });
    } catch (e) {
        return res.status(502).json({ ok: false, message: 'No se pudo consultar PVGIS' });
    }
};
