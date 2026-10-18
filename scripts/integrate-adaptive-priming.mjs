#!/usr/bin/env node
/**
 * Script de Integración: Espacio de Pre-lectura Adaptativo y Multilingüe (Lecta)
 * Diseñado para orquestar a Gemini 3.8 Flash sobre el árbol de archivos real de Lecta.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MODEL_ID = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const TARGET_FILES = [
  '.agents/rules/lecta-zero-friction.md',
  'src/client/lib/settings.ts',
  'src/client/lib/profile-models.ts',
  'src/client/lib/section-words.ts',
  'src/client/lib/preparation.ts',
  'src/client/lib/knowledge.ts',
  'src/client/components/SectionPreview.tsx',
  'src/client/components/ReaderMoreMenu.tsx',
  'src/client/components/Reader.tsx',
  'src/client/styles/reader.css',
];

const TRACK_PATH = '.agents/skills/lecta-ux-overhaul/tracks/track-6-adaptive-chapter-priming.md';

const TRACK_SPEC = `# Track 6: Adaptive & Multilingual Pre-Chapter Vocabulary Priming

## Rules & Constraints
- Follow \`.agents/rules/lecta-zero-friction.md\` strictly: reading pleasure and flow come first.
- Never block the user. The pre-chapter space must be skippable in 1 click and 100% disableable (per book or globally).
- Limit pre-chapter words to 3–5 high-utility items (Cowan's working memory limit).

## Tasks for ${MODEL_ID}
1. **Settings (\`src/client/lib/settings.ts\`)**:
   - Add \`chapterPrimingMode: 'auto' | 'on-demand' | 'off'\` (default \`'auto'\`), \`maxPrimingWords: 3 | 4 | 5\` (default \`4\`), and \`mutedPrimingBookIds: string[]\`.
   - Expose helpers to toggle mode and mute/unmute specific \`bookId\`s.

2. **Language-Specific Psychometrics (\`src/client/lib/profile-models.ts\`)**:
   - Extend user profile state to store \`thetaByLang: Record<string, number>\` so native books (L1) and foreign language books (L2) maintain independent ability estimates.
   - Implement Rasch 1PL mastery probability \`P(know) = 1 / (1 + exp(-(theta - beta)))\` and online Elo/Rasch update \`updateLanguageTheta(lang, beta, outcome)\`.

3. **Scientific Word Selector (\`src/client/lib/section-words.ts\` & \`src/client/lib/preparation.ts\`)**:
   - Rank chapter candidate words using:
     \`Utility = (1 - P(know)) * ln(1 + chapterFreq) * ZPD_Gaussian(theta, beta) * POS_Weight * FSRS_Retrievability_Boost\`.
   - Extract the real sentence from the chapter (max 140 chars) for contextual priming.
   - Support L2 books by prioritizing phrases/locuciones (\`phrases.ts\`) and contextual glosses (\`translate.ts\`).

4. **Editorial Pre-Chapter UI (\`src/client/components/SectionPreview.tsx\` & \`src/client/styles/reader.css\`)**:
   - Render a calm, non-intrusive editorial card at the start of a chapter.
   - Include: word lemma, POS badge, 1-click TTS pronunciation (\`speech.ts\`), 1-line gloss/translation, real chapter quote, \`✓ Ya la sé\` button (triggers \` outcome = 1 \` in \`knowledge.ts\` & \`profile-models.ts\`), and \`+ Repasar\` button (schedules in \`fsrs.ts\`).
   - Add an immediate \`Opciones ▾\` menu on the card with **"Ocultar en este libro"** and **"Desactivar pre-lectura siempre"**.

5. **Reader Integration & Passive Learning Loop (\`src/client/components/Reader.tsx\` & \`ReaderMoreMenu.tsx\`)**:
   - Add a toggle in \`ReaderMoreMenu.tsx\` to switch between Automático, Bajo demanda, and Desactivado.
   - When a user finishes a chapter without tapping a frontier word (\`theta ≈ beta\`), record a gentle passive mastery gain in \`knowledge.ts\`.
   - When a user taps an unpredicted word in \`WordPanel.tsx\`, record \`outcome = 0\` to recalibrate \`thetaByLang\` downward.
`;

async function main() {
  const rootDir = process.cwd();
  console.log(`[1/4] Creando especificación del Track 6 en ${TRACK_PATH}...`);
  await fs.mkdir(path.dirname(path.join(rootDir, TRACK_PATH)), { recursive: true });
  await fs.writeFile(path.join(rootDir, TRACK_PATH), TRACK_SPEC, 'utf8');

  console.log(`[2/4] Recopilando contexto de los archivos de Lecta...`);
  const fileContexts = [];
  for (const relPath of TARGET_FILES) {
    const fullPath = path.join(rootDir, relPath);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      fileContexts.push(`### FILE: ${relPath}\n\`\`\`typescript\n${content}\n\`\`\``);
    } catch {
      console.warn(`  ! Archivo opcional no encontrado: ${relPath}`);
    }
  }

  const fullPrompt = `${TRACK_SPEC}\n\n## Current Repository Files\n\n${fileContexts.join('\n\n')}\n\nReturn the updated files in JSON format: { "files": [ { "path": "string", "content": "string" } ] } preserving all existing tests and exports.`;

  const bundlePath = path.join(rootDir, '.agents/context-bundle-track-6.md');
  await fs.writeFile(bundlePath, fullPrompt, 'utf8');
  console.log(`  ✓ Contexto empaquetado guardado en ${bundlePath}`);

  if (!API_KEY) {
    console.log(`\n[Modo Local] No se detectó GEMINI_API_KEY en el entorno.`);
    console.log(`Puedes pasar el archivo '.agents/context-bundle-track-6.md' directamente a ${MODEL_ID} en tu IDE, o ejecutar:`);
    console.log(`GEMINI_API_KEY="tu_clave" node scripts/integrate-adaptive-priming.mjs`);
    return;
  }

  console.log(`[3/4] Invocando a ${MODEL_ID} para generar los parches de integración...`);
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
    throw new Error(`Error en la API de Gemini (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(rawText);

  for (const file of parsed.files || []) {
    const dest = path.join(rootDir, file.path);
    await fs.writeFile(dest, file.content, 'utf8');
    console.log(`  ✓ Actualizado: ${file.path}`);
  }

  console.log(`[4/4] Ejecutando suite de pruebas (Vitest) para validar la integración...`);
  execSync('pnpm test --run', { stdio: 'inherit' });
  console.log(`✅ Integración completada y verificada con éxito.`);
}

main().catch((err) => {
  console.error('❌ Error en el script de integración:', err);
  process.exit(1);
});
