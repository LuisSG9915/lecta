/**
 * Versión visible de Lecta.
 *
 * Vive aquí (y no leída de `package.json`) porque el cliente se compila con
 * `resolveJsonModule` apagado y porque el número debe aparecer idéntico en la
 * UI, en el reporte de diagnóstico copiado y en las pruebas. Al subir de
 * versión: este archivo, `package.json` y `mcp/package.json`.
 */
export const APP_VERSION = "0.2.5";
