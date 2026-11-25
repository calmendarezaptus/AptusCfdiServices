import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../index.js';

// Sin red: sin contexto de Catalyst la conexión falla antes de salir → 503 en JSON.
test('rutas: lecturas, validación sin red, escrituras con confirmar', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/636939444`;
    const send = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const original = console.error; console.error = () => {};
    try {
        for (const path of ['/cfdi/proveedor', '/cfdi/pendientes', '/cfdi', '/cfdi/7', '/cfdi/7/estatus', '/cfdi/7/pdf', '/cfdi/7/acuse', '/cfdi/preparar/446794000021109021',
            '/cfdi/preparar/446794000021109021/borrador', '/cfdi/complemento/preparar/183', '/pagos-por-complementar', '/clientes']) {
            const r = await send('GET', path);
            assert.equal(r.status, 503, path);
            assert.equal((await r.json()).stage, 'connection');
        }
        assert.equal((await send('GET', '/cfdi/7/zip')).status, 400);
        assert.equal((await send('GET', '/cfdi/x')).status, 400);
        assert.equal((await send('GET', '/cfdi?estado=borrado')).status, 400);
        assert.equal((await send('POST', '/cfdi/timbrar', { invoice_id: '1' })).status, 400);
        assert.equal((await send('POST', '/cfdi/timbrar', { invoice_id: '1', confirmar: true })).status, 503);
        assert.equal((await send('POST', '/cfdi/complemento', { payment_id: '1' })).status, 400);
        assert.equal((await send('POST', '/cfdi/7/cancelar', { motivo: '01', confirmar: true })).status, 400);
        assert.equal((await send('POST', '/cfdi/7/cancelar', { motivo: '02', confirmar: true })).status, 503);
        assert.equal((await send('PATCH', '/cfdi/7', {})).status, 404);
        assert.equal((await send('DELETE', '/cfdi/7')).status, 404);
        assert.equal((await fetch(base.replace('636939444', 'abc') + '/cfdi')).status, 400);
    } finally { server.close(); console.error = original; }
});
