/**
 * Función de Vercel: datos de red en vivo (precio de BTC, dificultad…).
 *   GET /api/network  →  lo mismo que el Worker /network
 * Puente al Worker desde los servidores de Vercel, para que funcione aunque la conexión
 * del usuario no llegue a Cloudflare. Se cachea 10 minutos en el borde de Vercel.
 */
const WORKER = 'https://solhash-license.reviewsmarcos.workers.dev/network';

module.exports = async function handler(req, res) {
    try {
        const r = await fetch(WORKER);
        const text = await r.text();
        res.status(r.status);
        res.setHeader('Content-Type', 'application/json');
        if (r.ok) res.setHeader('Cache-Control', 'public, s-maxage=600, max-age=300');
        return res.send(text);
    } catch (e) {
        return res.status(502).json({ ok: false, message: 'Datos de red no disponibles' });
    }
};
