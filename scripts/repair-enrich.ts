// Reparación puntual del catálogo (Fase 4): enriquece con DeepSeek las
// formas cuyas entradas `list` quedaron sin acepciones, usando el mismo
// prompt, validación e insertEnrichment que el worker. Escribe en
// lecta_dev.lexicon_* (catálogo compartido); no toca filas de usuarios.
//
// Uso (el bundle se genera una vez con esbuild; .env aporta
// DATABASE_URL apuntando a lecta_dev y DEEPSEEK_API_KEY):
//   node_modules/.bin/esbuild scripts/repair-enrich.ts --bundle \
//     --platform=node --format=cjs --packages=external \
//     --outfile=artifacts/repair-enrich.cjs
//   node --env-file=.env artifacts/repair-enrich.cjs forma1 forma2 …
//
// Cada forma corre en su propia transacción vía insertEnrichment; una
// falla en una no detiene a las demás. Jamás imprime la llave.
import pg from "pg";
import { requestEnrichment } from "../src/worker/ai";
import { insertEnrichment } from "../src/worker/lexicon";

const forms = process.argv.slice(2).map((f) => f.trim().toLowerCase()).filter(Boolean);
if (!forms.length) {
  console.error("uso: repair-enrich <forma> [forma…]");
  process.exit(1);
}

const env = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
  AI_GATEWAY_URL: process.env.AI_GATEWAY_URL ?? "",
  AI_GATEWAY_KEY: process.env.AI_GATEWAY_KEY ?? "",
} as never;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const form of forms) {
    const ai = await requestEnrichment(env, { form, language: "es" });
    if (!ai.ok) {
      console.log(`${form}: IA falló (${ai.reason})`);
      continue;
    }
    const entryId = await insertEnrichment(client, "es", ai.enrichment, form);
    console.log(
      `${form}: lema «${ai.enrichment.lemma}» ${ai.enrichment.pos}, ` +
        `${ai.enrichment.senses.length} acepción(es) → entry ${entryId}`,
    );
  }
} finally {
  await client.end();
}
