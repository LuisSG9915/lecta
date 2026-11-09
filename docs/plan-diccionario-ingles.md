# Plan: ampliar el diccionario inglés de Lecta (E + B)

Fecha: 2026-11-08
Estado: Aprobado por Luis (enfoque "E + B recomendado"). Fallback externo a
Wiktionary ya implementado en `WordPanel.tsx`.

## Diagnóstico

| Métrica | Español | Inglés |
|---|---|---|
| Lemas en catálogo (servidor) | ~126 905 (pack) / millones (servidor) | 19 011 |
| Acepciones | — | 32 317 |
| Formas | — | 65 832 |
| Entradas en dump kaikki (eswiktionary) | 856 366 | 23 085 |
| Lemas en pack descargable | 126 905 | 15 233 |

El inglés es ~15 % del español en lemas y su fuente principal (eswiktionary
sección "Inglés") solo aporta 23 085 entradas: **el techo de esa fuente ya
está cerca**. De ahí que muchas palabras inglesas no tengan definición.

## Objetivo

Subir la cobertura efectiva de palabras inglesas con definición en español de
~19 k a **≥ 60 k lemas** en 2-3 meses, sin degradar la calidad editorial ni
el tamaño del bundle.

## Fase E — Núcleo offline ampliado (1-2 días)

**Meta**: `english-core-lexicon.ts` pasa de ~250 a ~2 000 palabras de alta
frecuencia narrativa/literaria, con definición en español y traducción.

- Fuente: lista de frecuencia de wordfreq para inglés (top 5 000 lemas) filtrada
  por POS útil y por presencia en novelas (no jerga técnica).
- Definiciones: generarlas con IA (DeepSeek) en batch y revisar muestra del 10 %.
- Entregable: PR con el archivo ampliado + test de cobertura (`english-core-lexicon.test.ts`).
- Impacto: cobertura offline inmediata para las palabras más comunes; reduce
  consultas a red en libros en inglés.

## Fase B — Enriquecimiento masivo con IA (1-2 semanas)

**Meta**: +20-50 k lemas en el catálogo compartido (`lecta_dev`).

- Usar el endpoint existente `/api/lexicon/enrich` (DeepSeek) en modo batch
  (`enrichBatch`) para los lemas del dump kaikki enwiktionary que aún no estén
  en el catálogo.
- Fuente primaria: dump kaikki **enwiktionary** (palabras inglesas con
  definiciones en inglés) → traducir glosas con IA al español.
- Fuente secundaria: lemas de alta frecuencia en libros reales de usuarios
  (top por zipf medido en `lecta_user_*`).
- Cuota: reutilizar `lecta_ai_quota` (UPSERT atómico por hora); ejecutar en
  ventanas de baja carga (cron o script manual).
- Revisión editorial: muestra del 5 % + botón de reporte en ficha ya existente.
- Entregable: migración de datos aplicada a `lecta_dev` y `lecta`; bump de
  `LEXICON_CATALOG_REV` a `es:1, en:3`; regenerar pack inglés (`pnpm lexicon-pack --lang=en`).

## Fase F — Regenerar pack inglés (1 día, tras B)

- Subir versión en URL y SHA-256 en `DICTIONARY_PACKS` (`dictionaryPack.ts`).
- El cliente instala el pack nuevo en segundo plano al abrir un libro en/en.

## Fallback externo (ya implementado)

Cuando no hay definición local ni sesión/IA, `WordPanel` muestra un enlace a
`https://es.wiktionary.org/wiki/<palabra>` (Wiktionary en español, con glosas
en español para palabras inglesas). Cubre el "largo rabo" sin costo de IA.

## Riesgos y mitigaciones

- **Calidad de traducción IA**: revisión muestral + botón de reporte editorial.
- **Costo de IA**: cuota por hora ya existente; ejecutar en lotes pequeños.
- **Licencias**: kaikki (CC BY-SA 4.0 + GFDL) y definiciones IA (propias).
  Documentar en `docs/licencias-lexico.md`.
- **Tamaño del pack**: vigilar `check:size` (margen ~10 kB gzip). Si el pack
  inglés crece > 2 MB, considerar split por banda de frecuencia.

## Métricas de éxito

- Cobertura de palabras inglesas con definición ≥ 60 % en un corpus de 10
  novelas de prueba (medir con `scripts/catalog-seed.mjs`).
- Reducción de "no definida" en WordPanel en libros en inglés (medir vía
  `lecta_error_signatures` / eventos de consulta).
- `pnpm gate` verde en cada fase.

## Orden sugerido

1. Fase E (PR aislado, sin migración).
2. Fase B (script + carga a `lecta_dev`, luego `lecta` con autorización).
3. Fase F (regenerar pack).
4. Bump de `LEXICON_CATALOG_REV` y deploy.

## Nota del usuario

"Si no encontramos alguna palabra que pase directo a buscar a wikipedia" →
implementado como enlace a Wiktionary (glosas en español). Si se prefiere
Wikipedia para nombres propios/personajes, añadir enlace adicional en la
tarjeta de personaje (`character-helper`).
