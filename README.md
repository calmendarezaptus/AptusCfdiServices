# aptus_cfdi_services

Función de Catalyst (Advanced I/O, Node 24) del proyecto CFDI. Pasa por ReportesSandbox (proveedor
`aptus`), que llama a la API v2 de facturación **en modo prueba**. No recibe credenciales del PAC ni
escribe en Books. Timbrar, complementar y cancelar exigen `confirmar: true`.

- Rutas: `08-cfdi/PROYECTO.md` del repositorio de trabajo (AptusWidgets).
- `core/` es copia de `shared/catalyst-core`; no se edita aquí.

```bash
npm install
npm test
catalyst deploy --only functions:aptus_cfdi_services   # desde 08-cfdi
```
