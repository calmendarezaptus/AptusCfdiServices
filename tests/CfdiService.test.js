import test from 'node:test';
import assert from 'node:assert/strict';
import CfdiService, { validateCancelar, validateComplemento, validateLista, validateMonedaTc, validateTimbrar } from '../services/CfdiService.js';
import ArchivoService from '../services/ArchivoService.js';

const UUID = '843B5A51-A5C8-4CA9-BCC0-396179F37ECC';

test('timbrar y complemento: confirmar obligatorio e IDs de Books', () => {
    assert.throws(() => validateTimbrar({ invoice_id: '446794000021109021' }), /confirmar/);
    assert.throws(() => validateTimbrar({ invoice_id: '446794000021109021', confirmar: 'true' }), /confirmar/);
    assert.throws(() => validateTimbrar({ invoice_id: 'INV-1', confirmar: true }), /invoice_id/);
    assert.deepEqual(validateTimbrar({ invoice_id: '446794000021109021', confirmar: true, prueba: false, emisor: 'x' }), { invoice_id: '446794000021109021', confirmar: true });
    assert.deepEqual(validateComplemento({ payment_id: 183, confirmar: true }), { payment_id: '183', confirmar: true });
    assert.throws(() => validateComplemento({ payment_id: '1;2', confirmar: true }), /payment_id/);
});

test('cancelar: motivo 01-04; sustituto solo y siempre con 01', () => {
    assert.deepEqual(validateCancelar({ motivo: '02', confirmar: true }), { motivo: '02', confirmar: true });
    assert.deepEqual(validateCancelar({ motivo: '01', sustituto: ' ' + UUID.toLowerCase(), confirmar: true }), { motivo: '01', sustituto: UUID, confirmar: true });
    assert.throws(() => validateCancelar({ motivo: '01', confirmar: true }), /sustituye/);
    assert.throws(() => validateCancelar({ motivo: '02', sustituto: UUID, confirmar: true }), /solo aplica/);
    assert.throws(() => validateCancelar({ motivo: '05', confirmar: true }), /motivo/);
    assert.throws(() => validateCancelar({ motivo: '02' }), /confirmar/);
});

test('lista: solo filtros conocidos', () => {
    assert.deepEqual(validateLista({ tipo: 'P', estado: 'vigente,cancelado', invoice_number: 'INV-000856', otro: 'x', token: 'y' }), { tipo: 'P', estado: 'vigente,cancelado', invoice_number: 'INV-000856' });
    assert.throws(() => validateLista({ estado: 'borrado' }), /estado/);
    assert.throws(() => validateLista({ origen: 'creator' }), /origen/);
});

test('servicio: rutas de ReportesSandbox, cuerpos limpios y respuestas revisadas', async () => {
    const calls = [];
    const api = { request: async (m, p, o) => { calls.push([m, p, o.params ?? null, o.data ?? null]); return p === '/cfdi/timbrar' || p === '/cfdi/complemento' ? { cfdi_id: 7, estado: 'timbrando' } : { ok: true }; } };
    const s = new CfdiService('636939444', { api });
    await s.timbrar({ invoice_id: '446794000021109021', confirmar: true });
    await s.complemento({ payment_id: '183', confirmar: true });
    await s.cancelar('7', { motivo: '02', confirmar: true });
    await s.pendientes({ todas: '1' });
    await s.get('7', { solicitud: '1' });
    await s.preparar('446794000021109021');
    assert.deepEqual(calls.map(c => [c[0], c[1]]), [['post', '/cfdi/timbrar'], ['post', '/cfdi/complemento'], ['post', '/cfdi/7/cancelar'], ['get', '/cfdi/pendientes'], ['get', '/cfdi/7'], ['get', '/cfdi/preparar/446794000021109021']]);
    assert.deepEqual(calls[0][3], { invoice_id: '446794000021109021', confirmar: true });
    const raro = new CfdiService('636939444', { api: { request: async () => ({ estado: 'timbrando' }) } });
    await assert.rejects(raro.timbrar({ invoice_id: '1', confirmar: true }), e => e.status === 502 && e.outcome_unknown === true);
    await assert.rejects(s.get('x'), e => e.status === 400);
    assert.throws(() => new CfdiService('abc', { api }), /Organización/);
});

test('archivos: binario con el tipo correcto; errores sin el token', async () => {
    const config = { get: async () => ({ endpoint: 'https://x.test/api/', token: 'S3CR3T' }) };
    const calls = [];
    const pdf = new ArchivoService('636939444', { config, http: { request: async o => { calls.push(o); return { headers: { 'content-type': 'application/pdf' }, data: Buffer.from('%PDF') }; } } });
    const r = await pdf.cfdi('7', 'acuse');
    assert.equal(r.filename, 'CFDI-7-acuse.pdf');
    assert.equal(calls[0].url, 'https://x.test/api/cfdi/7/acuse');
    assert.equal(calls[0].responseType, 'arraybuffer');
    await pdf.borrador('446794000021109021');
    assert.deepEqual(calls[1].params, { borrador: '1', token: 'S3CR3T' });
    await assert.rejects(pdf.cfdi('7', 'xml'), e => e.status === 502 && /inesperado/.test(e.message)); // pidió XML y llegó PDF
    await assert.rejects(pdf.cfdi('7', 'zip'), e => e.status === 400);
    const err = new ArchivoService('636939444', { config, http: { request: async () => { throw Object.assign(new Error('https://x.test?token=S3CR3T'), { response: { status: 404, data: Buffer.from('{"error":"El PDF todavía no está disponible"}') } }); } } });
    await assert.rejects(err.cfdi('7', 'pdf'), e => e.status === 404 && /todavía/.test(e.message) && !/S3CR3T/.test(e.message));
    const lento = new ArchivoService('636939444', { config, http: { request: async () => { throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }); } } });
    await assert.rejects(lento.cfdi('7', 'pdf'), e => e.status === 504);
});

test('moneda y tipo de cambio: valores conocidos; manual exige TC válido; complementos sin moneda', () => {
    assert.deepEqual(validateMonedaTc({ moneda: 'mxn', tc_fuente: 'manual', tipo_cambio: '19.5', otro: 1 }), { moneda: 'mxn', tc_fuente: 'manual', tipo_cambio: 19.5 });
    assert.deepEqual(validateMonedaTc({ tc_fuente: 'banxico' }), { tc_fuente: 'banxico' });
    assert.throws(() => validateMonedaTc({ tc_fuente: 'manual' }), /Escribe/);
    assert.throws(() => validateMonedaTc({ tc_fuente: 'books', tipo_cambio: '19' }), /solo se escribe/);
    assert.throws(() => validateMonedaTc({ tc_fuente: 'manual', tipo_cambio: '19.1234567' }), /6 decimales/);
    assert.throws(() => validateMonedaTc({ tc_fuente: 'manual', tipo_cambio: '0' }), /mayor que 0/);
    assert.throws(() => validateMonedaTc({ moneda: 'usd' }), /factura o mxn/);
    assert.throws(() => validateMonedaTc({ moneda: 'mxn' }, { conMoneda: false }), /complemento/);
    assert.deepEqual(validateTimbrar({ invoice_id: '1', confirmar: true, moneda: 'factura', tc_fuente: 'manual', tipo_cambio: 22, confirmar_tipo_cambio: true }),
        { invoice_id: '1', confirmar: true, moneda: 'factura', tc_fuente: 'manual', tipo_cambio: 22, confirmar_tipo_cambio: true });
    assert.deepEqual(validateComplemento({ payment_id: '9', confirmar: true, tc_fuente: 'banxico', confirmar_tipo_cambio: 'si' }), { payment_id: '9', confirmar: true, tc_fuente: 'banxico' });
});

test('cancelable y archivos: parámetros limpios', async () => {
    const calls = [];
    const s = new CfdiService('636939444', { api: { request: async (m, p, o) => { calls.push([p, o.params]); return {}; } } });
    await s.cancelable('3', { motivo: '01', sustituto: '843b5a51-a5c8-4ca9-bcc0-396179f37ecc', x: 1 });
    await s.preparar('446794000031321005', { moneda: 'mxn', tc_fuente: 'banxico' });
    assert.deepEqual(calls, [['/cfdi/3/cancelable', { motivo: '01', sustituto: '843B5A51-A5C8-4CA9-BCC0-396179F37ECC' }], ['/cfdi/preparar/446794000031321005', { moneda: 'mxn', tc_fuente: 'banxico' }]]);
    await assert.rejects(s.cancelable('3', { motivo: '09' }), /motivo/);
    const pedidas = [];
    const a = new ArchivoService('636939444', { config: { get: async () => ({ endpoint: 'https://x.test', token: 't' }) },
        http: { request: async o => { pedidas.push([o.url, o.params]); return { headers: { 'content-type': o.params.formato === 'xml' ? 'application/xml' : 'application/pdf' }, data: Buffer.from('x') }; } } });
    assert.equal((await a.cfdi('3', 'acuse', { formato: 'xml' })).filename, 'CFDI-3-acuse.xml');
    assert.equal((await a.cfdi('3', 'pdf', { original: '1', formato: 'xml' })).filename, 'CFDI-3-original.pdf');
    await a.borrador('446794000031321005', 'pdf', { moneda: 'mxn', tc_fuente: 'manual', tipo_cambio: '19.5' });
    assert.deepEqual(pedidas.map(p => p[1]), [{ formato: 'xml', token: 't' }, { original: '1', token: 't' }, { moneda: 'mxn', tc_fuente: 'manual', tipo_cambio: 19.5, borrador: '1', token: 't' }]);
});
