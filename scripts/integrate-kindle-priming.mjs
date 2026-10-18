#!/usr/bin/env node
/**
 * Script de Integración Faseada: Pre-lectura Adaptativa para Kindle / E-Ink (Lecta)
 * Orquesta a Gemini 3.8 Flash sobre src/worker/kindle/ y valida con Vitest.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MODEL_ID = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const KINDLE_TARGET_FILES = [
  '.agents/rules/lecta-zero-friction.md',
  'src/worker/kindle/epub-reader.ts',
  'src/worker/kindle/epub-reader.test.ts',
  'src/worker/kindle/routes.ts',
  'src/worker/kindle/routes.test.ts',
  'src/worker/kindle/views.ts',
  'src/shared/word-form.ts',
  'src/shared/stopwords.ts',
  'db/migrations/007_user_knowledge.sql',
  'db/migrations/004_user_reviews.sql',
];

const TRACK_PATH = '.agents/skills/lecta-ux-overhaul/tracks/track-7-kindle-eink-priming.md';

const TRACK_SPEC = `# Track 7: Kindle & E-Ink Adaptive Pre-Chapter Vocabulary Priming

## Objective
Extend the scientific pre-chapter vocabulary priming space to the Kindle / E-Ink web reader (\`src/worker/kindle/\`) in 4 clean phases, respecting E-Ink hardware constraints (zero CSS animations/transitions, high-contrast monochrome, 44px+ tap targets, progressive enhancement with HTML forms) and \`.agents/rules/lecta-zero-friction.md\`.

## Phase Breakdown for ${MODEL_ID}

### Phase 1: Edge Lexical Extraction & Rasch ZPD Selector (\`src/worker/kindle/epub-reader.ts\`)
- Implement \`estimateThetaFromD1Knowledge\` using Rasch 1PL (\`1 / (1 + exp(-(theta - beta)))\`) over D1 \`user_knowledge\` records.
- Implement \`selectKindleChapterPrimingWords\` to select 3 to 5 optimal words per chapter using:
  \`Utility = (1 - P(know)) * ln(1 + chapterFreq) * ZPD_Gaussian(theta, beta)\`.
- Extract the exact chapter sentence (max 140 chars) via \`extractCompactContextSentence\`.
- Support both native language books (L1) and foreign language books (L2).

### Phase 2: Zero-Friction Routes, 1-Click Disable & D1 Sync (\`src/worker/kindle/routes.ts\`)
- When entering \`page === 0\` of a chapter and priming is enabled (neither \`lecta_k_priming_off\` nor \`lecta_k_mute_:bookId\` cookie is set, and \`?primed=1\` is not set), render the Kindle pre-chapter priming view if there are >= 1 high-utility words.
- Add \`POST /kindle/priming/action\` to handle:
  - \`known\`: Upsert \`status = 'known'\` in \`user_knowledge\` and recalibrate user theta upward.
  - \`save\`: Upsert \`status = 'learning'\` in \`user_knowledge\` and schedule in \`user_reviews\` (FSRS).
  - \`mute_book\`: Set cookie to hide priming for this \`bookId\` and redirect immediately to \`?primed=1\`.
  - \`disable_all\`: Set cookie to disable priming globally and redirect immediately to \`?primed=1\`.
- Add a toggle link in the Kindle reader top/bottom bar so the user can re-enable or disable pre-reading anytime.

### Phase 3: High-Contrast E-Ink UI & In-Chapter Anchors (\`src/worker/kindle/views.ts\`)
- Implement \`renderKindleChapterPrimingView\` with strict E-Ink CSS (\`transition: none !important\`, \`#000\` on \`#fff\`, 2px solid borders, 44px+ buttons) and progressive enhancement (\`window.lectaKindleAction\` via \`fetch\` to hide cards without full E-Ink page flash).
- Implement \`injectKindlePrimedAnchors\` so the 3–5 pre-read words appear in the chapter HTML with a dashed underline and compact inline gloss.

### Phase 4: Vitest Unit & Route Tests (\`epub-reader.test.ts\` & \`routes.test.ts\`)
- Add unit tests for \`selectKindleChapterPrimingWords\`, \`estimateThetaFromD1Knowledge\`, and \`extractCompactContextSentence\`.
- Add route tests in \`routes.test.ts\` verifying:
  1. Rendering of the pre-chapter view on chapter start.
  2. Immediate bypass when \`?primed=1\` or \`mute_book\` / \`disable_all\` is triggered.
  3. D1 \`user_knowledge\` updates when marking a word as \`known\` or \`save\`.
`;

async function main() {
  const rootDir = process.cwd();
  console.log(`[1/4] Guardando especificación detallada de las 4 fases en ${TRACK_PATH}...`);
  await fs.mkdir(path.dirname(path.join(rootDir, TRACK_PATH)), { recursive: true });
  await fs.writeFile(path.join(rootDir, TRACK_PATH), TRACK_SPEC, 'utf8');

  console.log(`[2/4] Empaquetando archivos de src/worker/kindle/ y esquemas D1...`);
  const contexts = [];
  for (const relPath of KINDLE_TARGET_FILES) {
    const fullPath = path.join(rootDir, relPath);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      contexts.push(`### FILE: ${relPath}\n\`\`\`\n${content}\n\`\`\``);
    } catch {
      console.warn(`  ! Archivo no encontrado (se omitirá del contexto): ${relPath}`);
    }
  }

  const fullPrompt = `${TRACK_SPEC}\n\n## Current Repository Files\n\n${contexts.join('\n\n')}\n\nReturn the updated files in JSON format: { "files": [ { "path": "string", "content": "string" } ] } preserving all existing functionality and tests.`;

  const bundlePath = path.join(rootDir, '.agents/context-bundle-track-7-kindle.md');
  await fs.writeFile(bundlePath, fullPrompt, 'utf8');
  console.log(`  ✓ Paquete de contexto listo en ${bundlePath}`);

  if (!API_KEY) {
    console.log(`\n[Modo Local] Pasa el archivo '.agents/context-bundle-track-7-kindle.md' a ${MODEL_ID} en tu IDE o ejecuta:`);
    console.log(`GEMINI_API_KEY="tu_clave" node scripts/integrate-kindle-priming.mjs`);
    return;
  }

  console.log(`[3/4] Ejecutando integración con ${MODEL_ID}...`);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Error en API de Gemini (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(rawText);

  for (const file of parsed.files || []) {
    const dest = path.join(rootDir, file.path);
    await fs.writeFile(dest, file.content, 'utf8');
    console.log(`  ✓ Archivo actualizado: ${file.path}`);
  }

  console.log(`[4/4] Ejecutando pruebas de Kindle en Vitest...`);
  execSync('pnpm test --run src/worker/kindle/', { stdio: 'inherit' });
  console.log(`✅ Las 4 fases de Pre-lectura en Kindle / E-Ink se integraron y pasaron todos los tests.`);
}

main().catch((err) => {
  console.error('❌ Error durante la integración de Kindle:', err);
  process.exit(1);
});