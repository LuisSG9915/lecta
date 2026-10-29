#!/usr/bin/env node
// Auditoría profunda del subsistema Kindle de Lecta utilizando Gemini 4 Argon (gemini-4-argon).
// Empaqueta el código fuente completo del lector, rutas, vistas y reglas de Zero-Scroll
// y consulta a Gemini 4 Argon con razonamiento extendido (thinking_level: "high")
// a través de la API moderna de Interactions de Google Gemini.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const MODEL_ID = "gemini-4-argon";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// Leer argumentos de línea de comandos
const args = process.argv.slice(2);
const isLive = args.includes("--live");
const apiKeyArg = args.find((a) => a.startsWith("--key="))?.split("=")[1];
const thinkingLevelArg = args.find((a) => a.startsWith("--thinking="))?.split("=")[1] || "high";
const outputFileArg = args.find((a) => a.startsWith("--output="))?.split("=")[1];

// Cargar clave de API (de argumento, entorno o archivo .env)
function resolveApiKey() {
  if (apiKeyArg) return apiKeyArg;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;

  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    const match = envContent.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY)=["']?([^"'\r\n]+)["']?/);
    if (match) return match[1];
  }
  return null;
}

const API_KEY = resolveApiKey();

console.log("===================================================================");
console.log("  🔬 AUDITORÍA PROFUNDA DE KINDLE / E-INK — GOOGLE GEMINI 4 ARGON");
console.log("===================================================================");
console.log(`Modelo objetivo:    ${MODEL_ID}`);
console.log(`Modo de ejecución:  ${isLive ? "LIVE (Llamada real a la API)" : "DRY-RUN (Evaluación y preparación)"}`);
console.log(`Nivel de thinking:  ${thinkingLevelArg}`);
console.log("-------------------------------------------------------------------\n");

// Archivos clave del subsistema Kindle a auditar
const KINDLE_SOURCE_FILES = [
  {
    path: "src/worker/kindle/epub-reader.ts",
    description: "Motor de parsing EPUB, paginación con presupuestos dinámicos, penalización de bloques y modelo Rasch/ZPD",
  },
  {
    path: "src/worker/kindle/routes.ts",
    description: "Rutas Hono del portal /k, sincronización de posiciones, antesala de pre-lectura, práctica FSRS y CSP",
  },
  {
    path: "src/worker/kindle/views.ts",
    description: "Estilos E-ink (KINDLE_CSS), plantillas HTML puras, selector de márgenes, ergonomía táctil y arte monocromo",
  },
  {
    path: ".agents/rules/lecta-zero-friction.md",
    description: "Reglas inquebrantables de diseño UX Zero-Friction y especificación técnica de Kindle Zero-Scroll",
  },
];

console.log("📦 1. Recopilando código fuente del subsistema Kindle...");
let totalChars = 0;
const bundledFiles = KINDLE_SOURCE_FILES.map((fileInfo) => {
  const fullPath = join(ROOT, fileInfo.path);
  if (!existsSync(fullPath)) {
    throw new Error(`Archivo crítico no encontrado: ${fullPath}`);
  }
  const content = readFileSync(fullPath, "utf-8");
  totalChars += content.length;
  console.log(`   ✓ ${fileInfo.path} (${content.length.toLocaleString()} caracteres)`);
  return {
    ...fileInfo,
    content,
  };
});

const estimatedTokens = Math.round(totalChars / 4);
console.log(`\n📊 Volumen de entrada estimado: ~${estimatedTokens.toLocaleString()} tokens (ventana disponible: 1.048.576 tokens).`);

// Construcción del prompt especializado de análisis para Gemini 4 Argon
const AUDIT_PROMPT = `Eres Gemini 4 Argon (gemini-4-argon), el modelo de razonamiento y análisis de ingeniería más avanzado de Google DeepMind.
Has sido comisionado para realizar una auditoría arquitectónica, algorítmica, psicométrica y ergonómica exhaustiva del subsistema de lectura Kindle y dispositivos de tinta electrónica (E-ink) de la plataforma Lecta.

### Contexto del Proyecto:
Lecta es una plataforma de lectura profunda que integra modelos de adquisición léxica incidental, teoría psicométrica (Rasch/IRT) y algoritmos de repetición espaciada (FSRS), ofreciendo una experiencia sin fricción (Zero-Friction UX).
El portal Kindle (/k y /kindle) está diseñado para navegadores de dispositivos de tinta electrónica con limitaciones severas de hardware (pantallas monocromas con refresco lento, memoria RAM restringida, procesadores lentos como los del Kindle Paperwhite/Oasis).

### Reglas Inquebrantables del Sistema:
1. Cero Scroll Vertical en modo paginado (1 página = 1 pantalla física <= 650px).
2. Sin enlaces interactivos <a> accidentales en el cuerpo del texto; se usan spans inertes con pulsación larga o modo consulta.
3. Cero frameworks pesados de JavaScript; se sirve HTML y CSS puro de alto contraste compilado en el Cloudflare Worker.
4. Preservación estricta de la posición de lectura, márgenes (sm/md/lg) y modos de lectura (Limpio, Párrafos, Léxico).

A continuación se adjuntan los archivos completos del subsistema Kindle:

${bundledFiles
  .map(
    (f) => `================================================================================
ARCHIVO: ${f.path}
DESCRIPCIÓN: ${f.description}
================================================================================
${f.content}
`
  )
  .join("\n\n")}

================================================================================
INSTRUCCIONES DE AUDITORÍA EXHAUSTIVA
================================================================================
Aplica tu máxima capacidad de razonamiento profundo para evaluar y desglosar rigurosamente:

1. ARQUITECTURA DE PAGINACIÓN Y PRESUPUESTO DE CARACTERES (src/worker/kindle/epub-reader.ts):
   - Evalúa el balance de los nuevos presupuestos dinámicos (sm: 1150/950, md: 900/750, lg: 680/540, xl: 500/390) y los multiplicadores de margen (sm x1.05, md x1.0, lg x0.90).
   - Analiza la penalización por salto de párrafo (BLOCK_BREAK_PENALTY = 22, PARAGRAPH_MODE_BREAK_PENALTY = 32). ¿Existen casos borde en textos con diálogos muy cortos o poesía donde ocurra desbordamiento vertical o infrautilización del viewport?
   - Revisa splitLongParagraph y splitHtmlIntoBlocks. ¿Puede alguna estructura HTML anidada romper el cálculo de peso?

2. ERGONOMÍA TÁCTIL, E-INK Y NAVEGACIÓN (src/worker/kindle/views.ts):
   - Evalúa las zonas táctiles laterales (25% retroceso / 75% avance), la pulsación sostenida (450ms) y la selección nativa.
   - Analiza la mitigación de ghosting y el impacto en la batería del Kindle. ¿Falta soporte de gestos swipe horizontal? ¿Cómo se comportan los objetivos táctiles en el navegador experimental de Kindle?
   - Revisa la barra compacta turn-page-bar y la cabecera del lector. ¿Qué metadatos adicionales (hora del sistema, páginas restantes del capítulo) optimizarían la experiencia sin saturar el diseño minimalista?

3. PSICOMETRÍA, ANTESALA Y MEMORIA EPISÓDICA (src/worker/kindle/routes.ts & epub-reader.ts):
   - Audita el cálculo del modelo Rasch (computeRaschMastery y estimateThetaFromD1Knowledge). ¿Es matemáticamente estable con registros dispersos?
   - Evalúa el filtro Zipf < 4.0 en la antesala de pre-lectura. ¿Puede alguna palabra demasiado común colarse o palabras críticas omitirse?
   - Examina el flujo de práctica FSRS en /k/practice. ¿Aprovecha adecuadamente el contexto del pasaje original para activar la memoria episódica?

4. SEGURIDAD, CSP Y RESILIENCIA EN CLOUDFLARE WORKERS:
   - Audita la Content Security Policy (KINDLE_HTML_CSP) y la función sanitizeKindleHtml. ¿Es 100% inmune a inyecciones SVG ofuscadas, entidades XML exóticas o XSS same-origin en /resource?
   - Analiza el manejo de memoria en el Worker de Cloudflare (< 128 MB) al procesar EPUBs voluminosos con DecompressionStream nativo.

5. PLAN MAESTRO DE MEJORA PRIORIZADO:
   - Sintetiza una matriz de mejoras clasificadas por impacto y esfuerzo técnico, con código TypeScript y CSS propuesto listo para producción.

Proporciona tu dictamen técnico con la máxima profundidad, rigor matemático y precisión de código.`;

// Preparación del payload para Gemini 4 Argon
const payload = {
  model: MODEL_ID,
  input: AUDIT_PROMPT,
  background: true,
  generation_config: {
    max_output_tokens: 131072,
    thinking_level: thinkingLevelArg,
  },
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const defaultOutDir = join(ROOT, "artifacts");
mkdirSync(defaultOutDir, { recursive: true });
const targetOutputFile = outputFileArg || join(defaultOutDir, `kindle-argon-audit-${timestamp}.md`);

if (!isLive) {
  console.log("🔍 MODO DRY-RUN ACTIVADO:");
  console.log("   Para ejecutar el análisis en vivo contra Gemini 4 Argon, ejecuta:");
  console.log("   node scripts/audit-kindle-argon.mjs --live\n");
  console.log("📄 Payload preparado con éxito:");
  console.log(`   - Modelo: ${payload.model}`);
  console.log(`   - Thinking Level: ${payload.generation_config.thinking_level}`);
  console.log(`   - Max Output Tokens: ${payload.generation_config.max_output_tokens}`);
  console.log(`   - Tamaño del prompt empaquetado: ${AUDIT_PROMPT.length.toLocaleString()} caracteres (~${estimatedTokens.toLocaleString()} tokens)`);
  console.log(`   - Archivo de salida configurado: ${targetOutputFile}`);
  
  if (!API_KEY) {
    console.log("\n⚠️  NOTA: No se detectó GEMINI_API_KEY en el entorno ni en .env.");
    console.log("   Para invocar la API en vivo, provee la clave mediante:");
    console.log("   export GEMINI_API_KEY=\"tu_api_key\" o pasando --key=AIzaSy...");
  } else {
    console.log(`\n🔑 Clave de API detectada: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`);
  }
  process.exit(0);
}

// Ejecución LIVE
if (!API_KEY) {
  console.error("❌ ERROR: Se especificó --live pero no se encontró ninguna clave de API.");
  console.error("   Configura GEMINI_API_KEY en tu entorno o en el archivo .env.");
  process.exit(1);
}

console.log("🚀 Enviando solicitud a Gemini 4 Argon (Interactions API)...");
console.log("   Configuración: background=true, thinking_level=" + thinkingLevelArg);

async function runLiveAudit() {
  try {
    const createRes = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Error en la llamada a la API (${createRes.status}): ${errText}`);
    }

    const created = await createRes.json();
    const interactionId = created.id;
    console.log(`\n✅ Interacción en segundo plano creada con ID: ${interactionId}`);
    console.log("⏳ Gemini 4 Argon está razonando en profundidad sobre el subsistema Kindle...");

    let status = created.status || "in_progress";
    let pollCount = 0;
    let interactionData = created;

    while (status === "in_progress" || status === "queued") {
      pollCount++;
      await new Promise((r) => setTimeout(r, 6000));
      process.stdout.write(`   [Paso ${pollCount}] Estado: ${status} (pensando y decodificando...)\r`);

      const pollRes = await fetch(`${API_URL}/${interactionId}`, {
        headers: {
          "x-goog-api-key": API_KEY,
        },
      });

      if (!pollRes.ok) {
        const pollErr = await pollRes.text();
        throw new Error(`Error al consultar estado de la interacción (${pollRes.status}): ${pollErr}`);
      }

      interactionData = await pollRes.json();
      status = interactionData.status;
    }

    console.log(`\n\n🏁 Interacción finalizada con estado: ${status}`);

    if (status !== "completed") {
      throw new Error(`La interacción no completó exitosamente. Estado: ${status}`);
    }

    // Extraer texto generado de los pasos de salida del modelo
    let finalText = "";
    if (interactionData.steps && Array.isArray(interactionData.steps)) {
      finalText = interactionData.steps
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n\n");
    } else if (interactionData.output_text) {
      finalText = interactionData.output_text;
    }

    if (!finalText) {
      finalText = JSON.stringify(interactionData, null, 2);
    }

    const fullReport = `# Informe de Auditoría Técnica Exhaustiva — Lecta Kindle
**Modelo Auditor:** Google Gemini 4 Argon (\`gemini-4-argon\`)  
**Fecha:** ${new Date().toISOString()}  
**Nivel de Razonamiento (Thinking Level):** ${thinkingLevelArg}  
**ID de Interacción:** \`${interactionId}\`  

---

${finalText}
`;

    writeFileSync(targetOutputFile, fullReport, "utf-8");
    console.log(`\n📄 ¡Informe guardado exitosamente!`);
    console.log(`   Ruta: ${targetOutputFile}`);
    console.log(`   Longitud del dictamen: ${finalText.length.toLocaleString()} caracteres.\n`);
  } catch (err) {
    console.error("\n❌ Error durante la auditoría con Gemini 4 Argon:", err.message);
    process.exit(1);
  }
}

runLiveAudit();
