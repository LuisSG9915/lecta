#!/usr/bin/env node
// Genera el dossier de auditoría del DISEÑO del modo acompañante de Lecta
// (docs/diseno-acompanante-lectura.md) en un único Markdown autocontenido
// listo para ser enviado a Google Argon (gemini-4-argon).
// Mismo patrón que scripts/generar-auditoria-argon.mjs.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FILES = [
  {
    name: "Documento de diseño bajo auditoría",
    path: "docs/diseno-acompanante-lectura.md",
    lang: "markdown",
  },
  {
    name: "Catálogo de capítulos y destinos lógicos",
    path: "src/client/lib/chapters.ts",
    lang: "typescript",
  },
  {
    name: "Analizador de capítulo (extracción + caché)",
    path: "src/client/lib/chapter-analysis.ts",
    lang: "typescript",
  },
  {
    name: "Selección personalizada de candidatas (θ + ZPD)",
    path: "src/client/lib/section-words.ts",
    lang: "typescript",
  },
  {
    name: "Confirmación de preparación (transacción + push)",
    path: "src/client/lib/preparation.ts",
    lang: "typescript",
  },
  {
    name: "IndexedDB: merges, lápidas y lotes",
    path: "src/client/lib/idb.ts",
    lang: "typescript",
  },
  {
    name: "Cuaderno: sincronización y notas de vocabulario",
    path: "src/client/lib/vocab.ts",
    lang: "typescript",
  },
  {
    name: "Perfil de usuario: θ y recorrido",
    path: "src/client/lib/profile-models.ts",
    lang: "typescript",
  },
  {
    name: "Cola de repaso post-capítulo",
    path: "src/client/lib/practice.ts",
    lang: "typescript",
  },
  {
    name: "Consulta del catálogo léxico (lookup/batch)",
    path: "src/client/lib/lexicon.ts",
    lang: "typescript",
  },
  {
    name: "Vista de hoja de palabras desacoplada",
    path: "src/client/components/SectionPreview.tsx",
    lang: "typescript",
  },
  {
    name: "Ruta A — selección en servidor (portal /k)",
    path: "src/worker/kindle/epub-reader.ts",
    lang: "typescript",
  },
  {
    name: "Ruta A — rutas del portal Kindle",
    path: "src/worker/kindle/routes.ts",
    lang: "typescript",
  },
  {
    name: "Ruta A — vistas HTML del portal Kindle",
    path: "src/worker/kindle/views.ts",
    lang: "typescript",
  },
];

console.log("Compilando el dossier de auditoría del diseño acompañante para Argon...");

let bundledCode = "";
for (const f of FILES) {
  const fullPath = join(ROOT, f.path);
  const content = readFileSync(fullPath, "utf-8");
  bundledCode += `\n### ARCHIVO: \`${f.path}\` (${f.name})\n\`\`\`${f.lang}\n${content}\n\`\`\`\n\n`;
}

const DOSSIER = `# AUDITORÍA DE DISEÑO: MODO ACOMPAÑANTE DE LECTA (VOCABULARIO PARA LECTURA EN PAPEL)
**Destinatario:** Google Gemini 4 Argon (\`gemini-4-argon\`)
**Especialidad:** Razonamiento profundo de sistemas, arquitectura de software y revisión de diseño
**Versión de Lecta:** v0.2.15
**Naturaleza:** auditoría de un documento de diseño SIN implementar. No escribas código de solución; señala defectos, verifica afirmaciones contra el código adjunto y propón plan de ejecución.

---

## 1. MISIÓN Y CONTEXTO DEL SISTEMA

Eres **Gemini 4 Argon** (\`gemini-4-argon\`), el modelo de razonamiento y análisis de ingeniería más avanzado de Google DeepMind. Tu misión es una **auditoría profunda, implacable y constructiva** del diseño «modo acompañante» de Lecta: una superficie donde el usuario lee su libro EN PAPEL (o en otro servicio) y usa la app solo para (a) recibir por capítulo las «posibles palabras complicadas» personalizadas a su nivel y (b) capturar a mano las palabras que encontró leyendo.

### Contexto de Lecta:
- PWA React 19 + TypeScript (cliente) sobre Cloudflare Workers (worker Hono). Datos de usuario en IndexedDB local por cuenta (\`lecta\` anónimo, \`lecta:u:<id>\`); sincronización a CockroachDB vía endpoints \`/api/*\`.
- Los EPUB viven en R2 bajo \`books/{userId}/*.epub\`; \`GET /api/books\` lista metadatos. El cliente puede descargar y parsear el EPUB completo en el navegador.
- Modelo de aprendizaje: calibración de vocabulario θ por idioma (escala \`4 − zipf\`), evidencia de conocimiento por lema, Cuaderno de palabras con tarjetas FSRS (\`ts-fsrs\`), y un pipeline de «preparación» por capítulo que hoy solo vive dentro del lector.
- Invariantes de datos NO negociables: merges por \`updatedAt\` con lápidas (\`deleted:true\`); claves de sesión versionadas (\`preparation:v1:\`, \`bookStart:v1:\`) que solo cambian con migración explícita; \`DbScope\` por cuenta (\`getActiveUserId()\` estable antes de empujar); IDs del catálogo int8 viajan como string; cero pools \`pg\` globales en el Worker.

### El documento bajo auditoría:
\`docs/diseno-acompanante-lectura.md\` (incluido íntegro en §3) propone dos rutas:
- **Ruta A:** extender el portal server-rendered \`/k\` (Kindle/e-ink) que ya tiene una antesala con selección propia (\`estimateThetaFromD1Knowledge\` + \`selectKindleChapterPrimingWords\`).
- **Ruta B (recomendada por el diseño):** superficie dentro de la app React que compone las mismas librerías del lector (\`buildChapterCatalog\` → \`createChapterAnalyzer\` → \`buildSuggestionRows\` → \`SectionPreview\` → \`confirmPreparation\`) más un alta manual con autocompletado sobre las formas del libro.

---

## 2. PREGUNTAS CRÍTICAS DE AUDITORÍA PARA ARGON

Aplica tu máxima capacidad de razonamiento profundo (*thinking_level: high*). Cita archivo:línea en cada veredicto.

### Bloque A — Fidelidad del mapa de reutilización (§2 del documento)
1. Verifica contra el código adjunto cada fila de la tabla §2.2: ¿existen las funciones citadas, con las firmas asumidas? ¿Quién más llama a \`createChapterAnalyzer\`, \`buildSuggestionRows\` y \`confirmPreparation\`? ¿Se sostiene la afirmación «SectionPreview está desacoplada» revisando sus props reales?
2. El documento afirma que \`useReaderChapterPrep\` está acoplado a \`Reader.tsx\` y no debe reusarse. Con lo que ves de las librerías, ¿es verosímil componer el pipeline sin ese hook? ¿Qué pieza falta por inventar (controlador, estado, caché por libro)?

### Bloque B — Ruta A vs Ruta B (§4 del documento)
3. El diseño recomienda la Ruta B por consistencia del modelo (mismo θ, misma selección). Ataca esa premisa: ¿cuán divergentes son realmente \`estimateThetaFromD1Knowledge\` + \`selectKindleChapterPrimingWords\` (servidor) frente a \`loadUserTheta\` + \`buildSuggestionRows\` (cliente)? ¿La divergencia justifica descartar la Ruta A?
4. ¿Existe una tercera ruta más simple que el diseño no vio? Evalúa en concreto: (a) servir la hoja desde el worker reusando el análisis cacheado; (b) un endpoint \`/api/chapter-words\` que devuelva candidatas pre-seleccionadas; (c) no descargar el EPUB y usar solo el índice/landmarks de \`user_books\`. Compara costo real de cada una contra la Ruta B.
5. La Ruta B descarga y parsea el EPUB completo. ¿Qué riesgos de memoria/latencia ves en móviles de gama baja, y mitiga el diseño suficiente la descarga (estado «Descargando…», error amable, caché)?

### Bloque C — Invariantes e integridad de datos (§6 del documento)
6. El alta manual escribirá en \`savedWords\` + \`knowledge\` vía \`saveWordWithKnowledge\`/\`savePreparationBatch\`. Verifica en \`idb.ts\` que los merges respetan lápidas y \`updatedAt\`; ¿hay algún camino por el que una palabra borrada resucite, o una evidencia se duplique, al capturar palabras desde el acompañante?
7. «Ya leí este capítulo» (§5.7): si se dispara \`buildPostChapterConsolidationQueue\`/consolidación sin haber leído en la app, ¿qué supuestos del modelo se rompen (exposición pasiva, reencuentros, FSRS)? ¿La recomendación del diseño se sostiene?
8. El autocompletado propone un índice de formas del libro cacheado como \`bookForms:v1:{hash}\`. Evalúa tamaño esperado, política de invalidación y si construirlo en idle tras la descarga es suficiente; propón el contenido mínimo de cada entrada.

### Bloque D — Decisiones de producto (§5 del documento)
9. ¿Qué decisión de producto relevante NO está listada en §5? Piensa en: usuarios sin cuenta, varios libros a la vez, libro borrado de R2 a medio flujo, capítulos front-matter sin texto, locuciones/multi-palabra.
10. De las decisiones listadas, ¿cuáles puedes resolver con evidencia del código adjunto en vez de opinión? Resuélvelas con cita.

### Bloque E — Ejecución de la Ruta B y cobertura
11. Enumera los componentes/hooks NUEVOS mínimos para la Ruta B y el orden de fases con verificación por fase (tipo \`pnpm gate\`: typecheck + lint 0 warnings + test + build + check:size 215 kB).
12. La regla del proyecto es cobertura ratchet: módulos nuevos nacen con pruebas herméticas. Lista las pruebas unitarias mínimas que exigirías al controlador del acompañante (análisis, filas, confirmación, alta manual, estados vacíos).
13. Estima el peso añadido al bundle inicial: qué debe ir detrás de \`import()\` y qué puede quedar estático. El presupuesto es 215 kB gzip y hoy va en ~180 kB.

### Bloque F — Matriz y veredicto
14. Devuelve una **matriz de hallazgos** clasificados por gravedad (crítico / importante / opcional): cada hallazgo con ubicación, evidencia, impacto y recomendación concreta. Cierra con: ¿apruebas la Ruta B tal como está diseñada, con qué correcciones, y qué de la Ruta A conviene rescatar como trabajo futuro?

---

## 3. DOCUMENTO DE DISEÑO Y CÓDIGO FUENTE

${bundledCode}`;

const outDir = join(ROOT, "artifacts");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "auditoria-acompanante-para-argon.md");
writeFileSync(outPath, DOSSIER, "utf-8");

console.log(`\n✅ Dossier de auditoría generado exitosamente en:`);
console.log(`   ${outPath}`);
console.log(`   Tamaño total: ${DOSSIER.length.toLocaleString()} caracteres (~${Math.round(DOSSIER.length / 4).toLocaleString()} tokens)`);
console.log(`\nListo para ser enviado directamente a Google Gemini 4 Argon.`);
