"use strict";
// Función del proyecto CFDI (Catalyst). Todo pasa por ReportesSandbox (proveedor `aptus`), que llama a la
// API v2 de facturación en MODO PRUEBA. Esta función no recibe credenciales del PAC ni escribe en Books.
// Timbrar, complementar y cancelar exigen `confirmar: true`.
import express from 'express';
import dotenv from 'dotenv';
import CfdiService from './services/CfdiService.js';
import ArchivoService from './services/ArchivoService.js';
import { registerCatalogRoutes } from './core/catalogs.js';
import { sendError } from './core/http.js';

dotenv.config();

const app = express();
app.use(express.json());

const route = (internalMessage, handler, status = 200) => async (req, res) => {
    try { return res.status(status).json(await handler(req)); }
    catch (error) { return sendError(res, error, internalMessage); }
};
const archivo = (internalMessage, handler) => async (req, res) => {
    try {
        const f = await handler(req);
        res.set({ 'Content-Type': f.contentType, 'Content-Disposition': `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename="${f.filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.send(f.body);
    } catch (error) { return sendError(res, error, internalMessage); }
};
const cfdi = req => new CfdiService(req.params.organizationId, { req });
const archivos = req => new ArchivoService(req.params.organizationId, { req });

// ── Lecturas ─────────────────────────────────────────────────────────────────
app.get('/:organizationId/cfdi/proveedor', route('Error interno consultando el proveedor de CFDI.', req => cfdi(req).proveedor()));
app.get('/:organizationId/cfdi/pendientes', route('Error interno consultando las facturas por timbrar.', req => cfdi(req).pendientes(req.query)));
app.get('/:organizationId/cfdi/preparar/:invoiceId', route('Error interno preparando el CFDI.', req => cfdi(req).preparar(req.params.invoiceId, req.query)));
app.get('/:organizationId/cfdi/preparar/:invoiceId/borrador', archivo('Error interno generando la vista previa.', req => archivos(req).borrador(req.params.invoiceId, req.query.formato || 'pdf', req.query)));
app.get('/:organizationId/cfdi/complemento/preparar/:paymentId', route('Error interno preparando el complemento.', req => cfdi(req).prepararComplemento(req.params.paymentId, req.query)));
app.get('/:organizationId/pagos-por-complementar', route('Error interno consultando los pagos.', req => cfdi(req).pagos()));
app.get('/:organizationId/cfdi', route('Error interno consultando los CFDI.', req => cfdi(req).lista(req.query)));
app.get('/:organizationId/cfdi/:cfdiId', route('Error interno consultando el CFDI.', req => cfdi(req).get(req.params.cfdiId, req.query)));
app.get('/:organizationId/cfdi/:cfdiId/cancelable', route('Error interno revisando la cancelación.', req => cfdi(req).cancelable(req.params.cfdiId, req.query)));
app.get('/:organizationId/cfdi/:cfdiId/estatus', route('Error interno consultando el estatus.', req => cfdi(req).estatus(req.params.cfdiId)));
app.get('/:organizationId/cfdi/:cfdiId/:archivo', archivo('Error interno descargando el archivo.', req => archivos(req).cfdi(req.params.cfdiId, req.params.archivo, req.query)));

// ── Escrituras (modo prueba) ─────────────────────────────────────────────────
app.post('/:organizationId/cfdi/timbrar', route('Error interno timbrando.', req => cfdi(req).timbrar(req.body), 202));
app.post('/:organizationId/cfdi/complemento', route('Error interno timbrando el complemento.', req => cfdi(req).complemento(req.body), 202));
app.post('/:organizationId/cfdi/:cfdiId/cancelar', route('Error interno cancelando.', req => cfdi(req).cancelar(req.params.cfdiId, req.body)));

// ── Catálogos de apoyo ──
export const CATALOGS = { clientes: [] };
registerCatalogRoutes(app, CATALOGS);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada en aptus_cfdi_services.' }));

export default app;
