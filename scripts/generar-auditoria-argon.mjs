#!/usr/bin/env node
// Genera el dossier completo de auditoría del subsistema Kindle de Lecta
// en un único archivo Markdown autocontenido listo para ser enviado a Google Argon (gemini-4-argon).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FILES = [
  {
    name: "Reglas de Diseño y Zero-Scroll",
    path: ".agents/rules/lecta-zero-friction.md",
    lang: "markdown",
  },
  {
    name: "Motor de Paginación y Psicometría (epub-reader.ts)",
    path: "src/worker/kindle/epub-reader.ts",
    lang: "typescript",
  },
  {
    name: "Rutas, Sesiones y Lógica de Servidor (routes.ts)",
    path: "src/worker/kindle/routes.ts",
    lang: "typescript",
  },
  {
    name: "Plantillas HTML, CSS E-ink y UI Táctil (views.ts)",
    path: "src/worker/kindle/views.ts",
    lang: "typescript",
  },
];

console.log("Compilando el dossier de auditoría completo para Argon...");

let bundledCode = "";
for (const f of FILES) {
  const fullPath = join(ROOT, f.path);
  const content = readFileSync(fullPath, "utf-8");
  bundledCode += `\n### ARCHIVO: \`${f.path}\` (${f.name})\n\`\`\`${f.lang}\n${content}\n\`\`\`\n\n`;
}

const DOSSIER = `# AUDITORÍA DE INGENIERÍA: SUBSISTEMA KINDLE & E-INK DE LECTA
**Destinatario:** Google Gemini 4 Argon (\`gemini-4-argon\`)  
**Especialidad:** Razonamiento profundo de sistemas, arquitectura de software y optimización ergonómica E-ink  
**Versión de Lecta:** v0.2.11  

---

## 1. MISIÓN Y CONTEXTO DEL SISTEMA

Eres **Gemini 4 Argon** (\`gemini-4-argon\`), el modelo de razonamiento y análisis de ingeniería más avanzado de Google DeepMind. Tu misión es realizar una **auditoría profunda, implacable y constructiva** del subsistema de lectura Kindle y tinta electrónica (E-ink) de la plataforma Lecta.

### Contexto de Lecta:
Lecta es una aplicación de lectura profunda que integra modelos de adquisición léxica incidental, teoría psicométrica (Rasch/IRT) y algoritmos de repetición espaciada (FSRS), priorizando una experiencia invisible y sin fricción (*Zero-Friction UX*).

El portal Kindle (\`/k\` y \`/kindle\`) corre íntegramente sobre **Cloudflare Workers**:
- **Restricciones de servidor:** Límite estricto de memoria RAM (< 128 MB), tiempo de CPU acotado (< 50 ms por petición) y sin Node.js runtime pesado (usando Streams y APIs web estándar).
- **Restricciones de dispositivo (Kindle Paperwhite/Oasis/Basic):** Procesadores lentos, pantallas monocromas de 16 tonos de gris con baja tasa de refresco, ausencia o limitación de JavaScript moderno en el navegador experimental de Amazon, y susceptibilidad al *ghosting* (sombras de páginas previas).

### Reglas Inquebrantables de Lecta en Kindle:
1. **Zero-Scroll Absoluto:** En modo paginado (\`layout=paged\`), 1 página renderizada debe equivaler exactamente a 1 pantalla física del Kindle (<= 650px) sin ningún desplazamiento vertical (\`scrollHeight <= clientHeight\`). Prohibido cualquier scroll vertical en lectura regular.
2. **Sin Enlaces <a> Accidentales:** En el cuerpo del texto no debe haber etiquetas \`<a>\` que provoquen navegación accidental al tocar la pantalla; las palabras se representan como \`<span class="w" data-w="...">\` inertes y se consultan mediante pulsación larga (450 ms), selección nativa o interruptor \`[ 🔍 Consultar ]\`.
3. **Cero Frameworks Pesados:** Todo el portal se sirve con HTML semántico ultraligero y CSS puro (\`KINDLE_CSS\`) generado en el servidor, con objetivos táctiles amplios (>= 44px) y alto contraste.

---

## 2. PREGUNTAS CRÍTICAS DE AUDITORÍA PARA ARGON

Aplica tu máxima capacidad de razonamiento profundo (*thinking_level: high*) para responder a los siguientes 6 bloques:

### Bloque A: Motor de Paginación y Densidad de Lectura (src/worker/kindle/epub-reader.ts)
1. **Presupuestos y márgenes:** Se acaban de calibrar los presupuestos a:
   - \`sm\`: standard 1150, pageZero 950 (multiplicador margen sm x1.05 = 1208 / 998)
   - \`md\`: standard 900, pageZero 750 (multiplicador margen md x1.0 = 900 / 750)
   - \`lg\`: standard 680, pageZero 540 (multiplicador margen lg x0.90 = 612 / 486)
   - \`xl\`: standard 500, pageZero 390
   ¿Existe algún caso límite en el que estos presupuestos combinados con párrafos largos divididos por \`splitLongParagraph\` causen un desbordamiento vertical (\`scrollHeight > clientHeight\`) en pantallas de 600×800 px o 600×680 px?
2. **Penalizaciones por salto de bloque:** Se utiliza \`BLOCK_BREAK_PENALTY = 22\` (y 32 en modo \`paragraphs\`). En capítulos con muchos diálogos cortos (ej. teatro o conversaciones rápidas de 15 caracteres por línea), ¿la penalización es suficiente para evitar que 25 diálogos cortos desborden la altura máxima de \`calc(100vh - 82px)\`? Si no lo es, ¿cuál es la fórmula matemática exacta que recomiendas?

### Bloque B: Ergonomía Táctil y Experiencia E-ink (src/worker/kindle/views.ts)
3. **Navegación y gestos:** Actualmente la navegación se basa en zonas táctiles (toque en 25% izquierdo = retroceso; 75% derecho = avance). En dispositivos de tinta electrónica táctiles (Kindle Paperwhite / Oasis / Kobo), los usuarios deslizan frecuentemente el pulgar (gesto *swipe*). ¿Cómo debe estructurarse el listener táctil (\`touchstart\`, \`touchmove\`, \`touchend\`) para detectar swipes horizontales con tolerancia a toques accidentales y latencia de pantalla lenta?
4. **Definición en línea (inline-lookup-card):** Cuando se abre la tarjeta flotante de consulta de una palabra, ¿es ergonómico el botón de cerrar? ¿Qué mejoras de CSS y estructura táctil recomiendas para evitar que un usuario pulse accidentalmente el texto del libro detrás o cerca del modal?
5. **Mitigación de Ghosting:** En E-ink, tras 10–15 cambios de página sucesivos se acumulan sombras tenues de tinta. ¿Qué técnica recomiendas implementar desde el HTML/CSS/JS del servidor (ej. destello de pantalla blanco/negro cada N páginas o botón de refresco limpio) para eliminar el ghosting sin degradar la batería?

### Bloque C: Psicometría, Antesala y Memoria Episódica (src/worker/kindle/routes.ts)
6. **Modelo Rasch y estimación de habilidad (θ):** La antesala selecciona palabras en la Zona de Desarrollo Próximo (ZPD) usando \`P(\\theta) = \\frac{1}{1 + e^{-(\\theta - \\beta)}}\` con filtro de frecuencia Zipf < 4.0. ¿Qué áreas de mejora matemática detectas en \`estimateThetaFromD1Knowledge\` y \`selectKindleChapterPrimingWords\` cuando un usuario tiene pocos registros en su historial?
7. **Práctica FSRS y Memoria Episódica:** En \`/k/practice\`, se presentan opciones múltiples para las palabras guardadas. ¿Cómo podemos enriquecer la pregunta mostrando la cita o pasaje original del libro donde el lector la encontró subrayada, sin romper la simplicidad visual de la pantalla?

### Bloque D: Seguridad, CSP y Manejo de Recursos en Cloudflare Workers
8. **Seguridad y CSP:** Evalúa \`KINDLE_HTML_CSP\` y la sanitización en \`sanitizeKindleHtml\`. ¿Hay algún vector de escape XSS en el visor de recursos \`/k/read/:hash/resource\` o en las entidades XML de los archivos EPUB subidos por los usuarios?
9. **Consumo de memoria en Worker:** Al descomprimir zips con \`DecompressionStream\` nativo en \`epub-reader.ts\`, ¿existe riesgo de agotamiento de memoria ante EPUBs de más de 30 MB con muchas ilustraciones?

### Bloque E: Plan de Acción Priorizado y Código Concreto
10. Proporciona una **matriz de mejoras clasificadas por impacto y esfuerzo técnico**, acompañada de los bloques de código TypeScript y CSS listos para ser incorporados directamente en Lecta.

---

## 3. CÓDIGO FUENTE COMPLETO DEL SUBSISTEMA KINDLE

${bundledCode}
`;

const outDir = join(ROOT, "artifacts");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "auditoria-kindle-para-argon.md");
writeFileSync(outPath, DOSSIER, "utf-8");

console.log(`\n✅ Dossier de auditoría generado exitosamente en:`);
console.log(`   ${outPath}`);
console.log(`   Tamaño total: ${DOSSIER.length.toLocaleString()} caracteres (~${Math.round(DOSSIER.length / 4).toLocaleString()} tokens)`);
console.log(`\nListo para ser enviado directamente a Google Gemini 4 Argon.`);
