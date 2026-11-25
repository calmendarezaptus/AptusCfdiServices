import axios from 'axios';
import DbConfigService from '../core/DbConfigService.js';
import { CfdiError } from './CfdiService.js';

// Archivos binarios del CFDI (XML, PDF, acuse y el borrador de vista previa). No pasan por
// core/PrebillApiClient (solo acepta JSON); usan la misma conexión de cm_global_vars.
// Nunca se registra la URL ni el error de axios: llevan el token.
export const ARCHIVO_TIMEOUT = 25000;
const MAX_BYTES = 15 * 1024 * 1024;
const orgId = v => typeof v === 'string' && /^\d{1,20}$/.test(v);
const localId = v => typeof v === 'string' && /^\d{1,12}$/.test(v);
const booksId = v => typeof v === 'string' && /^\d{1,25}$/.test(v);
export const ARCHIVOS = ['xml', 'pdf', 'acuse'];

const TIPOS = { pdf: /application\/pdf/, xml: /(application|text)\/xml/ };

function errorDe(cause) {
    if (cause?.code === 'ECONNABORTED' || /timeout/i.test(cause?.message ?? '')) return new CfdiError('El archivo tardó demasiado. Vuelve a intentarlo en unos segundos.', 504, { stage: 'archivo' });
    const status = cause?.response?.status;
    let apiMessage = null;
    try {
        const json = JSON.parse(Buffer.from(cause?.response?.data ?? '').toString('utf8'));
        if (typeof json?.error === 'string') apiMessage = json.error;
    } catch { /* no era JSON */ }
    if ([400, 404, 409, 422].includes(status) && apiMessage) return new CfdiError(apiMessage, status, { stage: 'archivo' });
    if (status === 503) return new CfdiError(apiMessage || 'El servicio de CFDI no está disponible.', 503, { stage: 'archivo' });
    return new CfdiError('No se pudo obtener el archivo del servicio de Aptus.', 502, { stage: 'archivo', provider_status: status ?? null });
}

export default class ArchivoService {
    constructor(organizationId, { http = axios, config = null, req = null } = {}) {
        if (!orgId(organizationId)) throw new CfdiError('Organización inválida.');
        this.http = http;
        this.config = config ?? { get: async () => {
            const c = await new DbConfigService(organizationId, req).getDbConfig();
            return { endpoint: c.APTUS_MIRROR_DB_ENDPOINT, token: c.APTUS_MIRROR_DB_TOKEN };
        } };
    }

    async traer(path, params, formato, filename) {
        let connection;
        try { connection = await this.config.get(); } catch { connection = null; }
        if (!connection?.endpoint || !connection?.token) throw new CfdiError('Faltan parámetros de conexión con el servicio de Aptus. Por favor contacte a un administrador.', 503, { stage: 'connection' });
        const url = String(connection.endpoint).replace(/\/+$/, '') + path;
        let response;
        try {
            response = await this.http.request({ method: 'get', url, params: { ...params, token: connection.token }, timeout: ARCHIVO_TIMEOUT, responseType: 'arraybuffer', maxContentLength: MAX_BYTES });
        } catch (cause) { throw errorDe(cause); }
        const type = String(response.headers?.['content-type'] ?? '');
        if (!TIPOS[formato].test(type)) throw new CfdiError('El servicio de Aptus devolvió un archivo inesperado.', 502, { stage: 'archivo' });
        return { contentType: formato === 'pdf' ? 'application/pdf' : 'application/xml; charset=utf-8', filename, body: Buffer.from(response.data) };
    }

    // XML, PDF o acuse (PDF) de un CFDI guardado.
    async cfdi(id, archivo) {
        if (!localId(id)) throw new CfdiError('ID de CFDI inválido.');
        if (!ARCHIVOS.includes(archivo)) throw new CfdiError('Archivo inválido: xml, pdf o acuse.');
        const formato = archivo === 'xml' ? 'xml' : 'pdf';
        return this.traer(`/cfdi/${id}/${archivo}`, {}, formato, `CFDI-${id}${archivo === 'acuse' ? '-acuse' : ''}.${formato}`);
    }

    // Vista previa (borrador sellado sin timbrar): no consume la llave ni timbra.
    async borrador(invoiceId, formato = 'pdf') {
        if (!booksId(invoiceId)) throw new CfdiError('ID de factura inválido.');
        if (!['pdf', 'xml'].includes(formato)) throw new CfdiError('Formato inválido: pdf o xml.');
        return this.traer(`/cfdi/preparar/${invoiceId}`, formato === 'xml' ? { borrador: '1', formato: 'xml' } : { borrador: '1' }, formato, `Borrador-${invoiceId}.${formato}`);
    }
}
