// Zona OMDb/SubDL/Trakt apagada (decisión 2026-11-15): sin una fuente
// de metadatos con licencia comercial, el worker responde 503 en
// /api/screen/* y el cliente no pinta el crédito a Trakt ni conserva las
// obras que vinieron de ahí. Ver docs/designs/2026-11-15-explora-derechos.md.
export const SCREEN_ZONE_ENABLED = false;

// «Series y películas» con los subtítulos del propio usuario: el archivo
// se procesa en el navegador y la guía queda solo en el dispositivo; no
// usa /api/screen/* ni terceros.
export const SUBTITLE_ZONE_ENABLED = true;
