/**
 * Materiales para diseñar una instalación solar nueva (SolHash Pro V2).
 * Precios de referencia SIN IVA, tomados del presupuesto real de la ampliación de Alange
 * (noviembre de 2026) y de precios habituales de mercado. Actualízalos con los de tu proveedor:
 * la V2 calcula el presupuesto de cada proyecto con estas cifras.
 *
 *   Alange: 36 paneles 595 W + transporte 2.919,68 € → 81,10 €/panel
 *           inversor híbrido Solis 12 kW 1.275,34 € · estructura suelo 1.227,27 € (34 €/panel)
 *           cableado y protecciones 650 € · cimentación 450 € (12,5 €/panel)
 */
var SOLAR_MATERIALS = {
    fecha: '2026-11-21',
    panel: { name: 'Panel solar bifacial 595 W (N-TOPCon)', w: 595, price: 81, areaM2: 2.6 },
    // Inversores híbridos (admiten batería). Hasta 12 kW monofásicos; a partir de 15 kW, trifásicos.
    inverters: [
        { kw: 3.6, price: 650 }, { kw: 5, price: 750 }, { kw: 6, price: 850 }, { kw: 8, price: 1050 },
        { kw: 10, price: 1150 }, { kw: 12, price: 1275 },
        { kw: 15, price: 1700, tri: true }, { kw: 20, price: 2100, tri: true }, { kw: 25, price: 2600, tri: true }, { kw: 30, price: 3100, tri: true }
    ],
    maxDcAcRatio: 1.3,          // hasta un 30 % más de paneles que inversor (recorte pequeño en verano)
    structure: {
        tejado: { label: 'Estructura coplanar para tejado', perPanel: 28 },
        suelo:  { label: 'Estructura de aluminio sobre suelo', perPanel: 34, foundationPerPanel: 12.5 }
    },
    electrical: { label: 'Cableado solar, conectores y cuadros de protección', base: 250, perPanel: 11 },
    battery: { name: 'Batería LiFePO4 48 V de 5,12 kWh (módulo rack)', kwh: 5.12, price: 700 },
    labor: { label: 'Mano de obra del instalador', perKwp: 180, min: 600 },
    permits: { label: 'Legalización y boletín eléctrico', price: 350 },
    vat: 0.21
};
