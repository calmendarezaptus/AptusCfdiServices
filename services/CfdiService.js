import PrebillApiClient from '../core/PrebillApiClient.js';

// CFDI con el proveedor `aptus` de ReportesSandbox (que llama a la API v2 de facturación, hoy solo en
// modo prueba). Esta función NUNCA recibe ni guarda credenciales del PAC: solo manda IDs, `confirmar`
// y el motivo de cancelación. Timbrar, complementar y cancelar exigen `confirmar: true`.
export class CfdiError extends Error {
    constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, { stage: 'validation', outcome_unknown: false }, extra); }
}

const orgId = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
const booksId = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
const localId = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
export const MOTIVOS = ['01', '02', '03', '04'];
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

function confirmado(body) {
    if (!isObject(body) || body.confirmar !== true) throw new CfdiError('Falta confirmar la operación (confirmar: true).');
}

// Moneda y tipo de cambio (fase 2). `moneda` solo en facturas; en complementos solo la fuente del TC.
export const MONEDAS_CFDI = ['factura', 'mxn'];
export const FUENTES_TC = ['books', 'banxico', 'manual'];
const TC = /^\d{1,6}(\.\d{1,6})?$/;
export function validateMonedaTc(src = {}, { conMoneda = true } = {}) {
    const out = {};
    if (src.moneda !== undefined && src.moneda !== '') {
        if (!conMoneda) throw new CfdiError('En un complemento no se elige la moneda.');
        if (!MONEDAS_CFDI.includes(src.moneda)) throw new CfdiError('moneda debe ser factura o mxn.');
        out.moneda = src.moneda;
    }
    if (src.tc_fuente !== undefined && src.tc_fuente !== '') {
        if (!FUENTES_TC.includes(src.tc_fuente)) throw new CfdiError('tc_fuente debe ser books, banxico o manual.');
        out.tc_fuente = src.tc_fuente;
    }
    const tc = typeof src.tipo_cambio === 'number' ? String(src.tipo_cambio) : src.tipo_cambio;
    if (tc !== undefined && tc !== '' && tc !== null) {
        if (out.tc_fuente !== 'manual') throw new CfdiError('El tipo de cambio solo se escribe con la fuente manual.');
        if (typeof tc !== 'string' || !TC.test(tc) || Number(tc) <= 0) throw new CfdiError('Tipo de cambio inválido: mayor que 0 y hasta 6 decimales.');
        out.tipo_cambio = Number(tc);
    } else if (out.tc_fuente === 'manual') throw new CfdiError('Escribe el tipo de cambio manual.');
    return out;
}

export function validateTimbrar(body) {
    confirmado(body);
    const id = typeof body.invoice_id === 'number' ? String(body.invoice_id) : body.invoice_id;
    if (!booksId(id)) throw new CfdiError('invoice_id debe ser el ID de la factura en Books.');
    const out = { invoice_id: id, confirmar: true, ...validateMonedaTc(body) };
    if (body.confirmar_tipo_cambio === true) out.confirmar_tipo_cambio = true;
    return out;
}

export function validateComplemento(body) {
    confirmado(body);
    const id = typeof body.payment_id === 'number' ? String(body.payment_id) : body.payment_id;
    if (!booksId(id)) throw new CfdiError('payment_id debe ser el ID del pago en Books.');
    const out = { payment_id: id, confirmar: true, ...validateMonedaTc(body, { conMoneda: false }) };
    if (body.confirmar_tipo_cambio === true) out.confirmar_tipo_cambio = true;
    return out;
}

export function validateCancelar(body) {
    confirmado(body);
    if (!MOTIVOS.includes(body.motivo)) throw new CfdiError('motivo debe ser 01, 02, 03 o 04.');
    const payload = { motivo: body.motivo, confirmar: true };
    if (body.motivo === '01') {
        if (typeof body.sustituto !== 'string' || !UUID.test(body.sustituto.trim())) throw new CfdiError('Con el motivo 01 indica el UUID del CFDI que sustituye al cancelado.');
        payload.sustituto = body.sustituto.trim().toUpperCase();
    } else if (body.sustituto !== undefined && body.sustituto !== null && body.sustituto !== '') {
        throw new CfdiError('El UUID sustituto solo aplica con el motivo 01.');
    }
    return payload;
}

// Filtros de la lista GET /cfdi (los demás no se reenvían).
const FILTROS = {
    origen: v => ['aptus', 'interno'].includes(v),
    tipo: v => ['I', 'E', 'P'].includes(v),
    estado: v => v.split(',').every(e => ['timbrando', 'vigente', 'cancelacion_en_proceso', 'cancelado', 'error'].includes(e)),
    invoice_id: booksId, payment_id: booksId,
    invoice_number: v => /^[\w-]{1,40}$/.test(v),
};
export function validateLista(query = {}) {
    const params = {};
    for (const [k, ok] of Object.entries(FILTROS)) {
        const v = query[k];
        if (v === undefined || v === '') continue;
        if (typeof v !== 'string' || !ok(v)) throw new CfdiError(`Filtro inválido: ${k}.`);
        params[k] = v;
    }
    return params;
}

const unexpected = what => new CfdiError(`El servicio de Aptus devolvió ${what} con formato inesperado.`, 502, { stage: 'response', outcome_unknown: true });

export default class CfdiService {
    constructor(organizationId, { api = null, req = null } = {}) {
        if (!orgId(organizationId)) throw new CfdiError('Organización inválida.');
        this.api = api ?? new PrebillApiClient(organizationId, { req });
    }

    // ── Lecturas ──
    async proveedor() { return this.api.request('get', '/cfdi/proveedor', { stage: 'cfdi_proveedor' }); }
    async pendientes(query = {}) {
        const params = query.todas === '1' ? { todas: '1' } : {};
        return this.api.request('get', '/cfdi/pendientes', { params, stage: 'cfdi_pendientes', timeout: 25000 });
    }
    async lista(query) { return this.api.request('get', '/cfdi', { params: validateLista(query), stage: 'cfdi_lista' }); }
    async get(id, query = {}) {
        if (!localId(id)) throw new CfdiError('ID de CFDI inválido.');
        return this.api.request('get', '/cfdi/' + id, { params: query.solicitud === '1' ? { solicitud: '1' } : {}, stage: 'cfdi_get' });
    }
    async preparar(invoiceId, query = {}) {
        if (!booksId(invoiceId)) throw new CfdiError('ID de factura inválido.');
        return this.api.request('get', '/cfdi/preparar/' + invoiceId, { params: validateMonedaTc(query), stage: 'cfdi_preparar', timeout: 25000 });
    }
    async pagos() { return this.api.request('get', '/pagos-por-complementar', { stage: 'cfdi_pagos', timeout: 25000 }); }
    async prepararComplemento(paymentId, query = {}) {
        if (!booksId(paymentId)) throw new CfdiError('ID de pago inválido.');
        return this.api.request('get', '/cfdi/complemento/preparar/' + paymentId, { params: validateMonedaTc(query, { conMoneda: false }), stage: 'cfdi_complemento_preparar', timeout: 25000 });
    }
    // ¿Se puede cancelar? (p. ej. una PPD con complementos vigentes no). Acepta ?motivo= y ?sustituto=.
    async cancelable(id, query = {}) {
        if (!localId(id)) throw new CfdiError('ID de CFDI inválido.');
        const params = {};
        if (query.motivo) { if (!MOTIVOS.includes(query.motivo)) throw new CfdiError('motivo debe ser 01, 02, 03 o 04.'); params.motivo = query.motivo; }
        if (query.sustituto) { if (typeof query.sustituto !== 'string' || !UUID.test(query.sustituto)) throw new CfdiError('UUID sustituto inválido.'); params.sustituto = query.sustituto.toUpperCase(); }
        return this.api.request('get', `/cfdi/${id}/cancelable`, { params, stage: 'cfdi_cancelable', timeout: 25000 });
    }
    async estatus(id) {
        if (!localId(id)) throw new CfdiError('ID de CFDI inválido.');
        return this.api.request('get', `/cfdi/${id}/estatus`, { stage: 'cfdi_estatus', timeout: 25000 });
    }

    // ── Escrituras (ReportesSandbox → API v2 en modo prueba) ──
    async timbrar(body) {
        const data = await this.api.request('post', '/cfdi/timbrar', { data: validateTimbrar(body), stage: 'cfdi_timbrar', timeout: 25000 });
        if (!isObject(data) || !Number.isInteger(data.cfdi_id)) throw unexpected('el trabajo de timbrado');
        return data;
    }
    async complemento(body) {
        const data = await this.api.request('post', '/cfdi/complemento', { data: validateComplemento(body), stage: 'cfdi_complemento', timeout: 25000 });
        if (!isObject(data) || !Number.isInteger(data.cfdi_id)) throw unexpected('el trabajo del complemento');
        return data;
    }
    async cancelar(id, body) {
        if (!localId(id)) throw new CfdiError('ID de CFDI inválido.');
        const data = await this.api.request('post', `/cfdi/${id}/cancelar`, { data: validateCancelar(body), stage: 'cfdi_cancelar', timeout: 28000 });
        if (!isObject(data)) throw unexpected('la cancelación');
        return data;
    }
}
