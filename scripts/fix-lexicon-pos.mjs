// Corrige el POS de entries del catálogo inglés enriquecido por IA.
//
// Contexto: scripts/enrich-english-ia.mjs insertaba con
// `POS_MAP[pos] ?? "sustantivo"` donde `pos` ya venía en español desde la IA,
// así que ~1 900 entries quedaron como 'sustantivo' sin importar la palabra.
// Este script aplica los cambios pre-calculados en
// artifacts/pos-fix-cambios.json (derivados del dump kaikki
// data/lexicon/en-wiktionary.jsonl.gz, que sí trae el POS real).
//
// Solo corrige entries cuyo (lemma, pos destino) NO existe ya en el catálogo
// (los duplicados sobre entries wiktionary quedan fuera: requieren decisión
// editorial de merge, ver artifacts/pos-fix-ambiguos.json).
//
// Uso:
//   node --env-file=.env scripts/fix-lexicon-pos.mjs          # dry-run
//   node --env-file=.env scripts/fix-lexicon-pos.mjs --apply  # escribe en lecta_dev y lecta
//
// Requiere DATABASE_URL apuntando a lecta (prod); lecta_dev se deriva igual
// que en sync-lexicon-en-prod.mjs.

import pg from "pg";
import { readFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const cambios = JSON.parse(readFileSync("artifacts/pos-fix-cambios.json", "utf8"));
const prodUrl = process.env.DATABASE_URL;
if (!prodUrl || !/\/lecta(\?|$)/.test(prodUrl)) {
  console.error("DATABASE_URL no apunta a lecta (prod).");
  process.exit(1);
}
const devUrl = prodUrl.replace(/\/lecta(?=\?|$)/, "/lecta_dev");

const CHUNK = 200;

for (const [name, url] of [
  ["lecta_dev", devUrl],
  ["lecta", prodUrl],
]) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Guardia: abortar si algún (lemma, pos destino) ya existe como OTRA entry.
    // Consulta exacta por pares (lemma,pos); la propia entry no puede coincidir
    // porque from != pos destino en cada cambio.
    const blocked = [];
    for (let i = 0; i < cambios.length; i += CHUNK) {
      const slice = cambios.slice(i, i + CHUNK);
      const params = [];
      const tuples = slice.map((c, j) => {
        params.push(c.lemma, c.pos);
        return `($${j * 2 + 1}::text, $${j * 2 + 2}::text)`;
      });
      const { rows } = await client.query(
        `SELECT v.lemma, v.pos FROM (VALUES ${tuples.join(",")}) AS v(lemma, pos)
         JOIN lexicon_entries e ON e.language = 'en' AND e.lemma = v.lemma AND e.pos = v.pos`,
        params,
      );
      blocked.push(...rows.map((r) => `${r.lemma}::${r.pos}`));
    }
    if (blocked.length > 0) {
      console.error(`[${name}] ${blocked.length} conflictos de (lemma,pos); abortando sin escribir.`);
      console.error(blocked.slice(0, 5).join(" | "));
      process.exit(1);
    }

    if (!apply) {
      console.log(`[${name}] dry-run: ${cambios.length} entries por corregir.`);
      continue;
    }

    await client.query("BEGIN");
    let updated = 0;
    for (const c of cambios) {
      // El guard `pos = c.from` hace el UPDATE idempotente: si ya se aplicó,
      // no toca la fila.
      const res = await client.query(
        `UPDATE lexicon_entries SET pos = $2
         WHERE id = $1::int8 AND language = 'en' AND pos = $3`,
        [c.id, c.pos, c.from],
      );
      updated += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    console.log(`[${name}] ${updated}/${cambios.length} entries corregidas.`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    console.error(`[${name}] ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}
console.log(apply ? "Listo." : "Dry-run: usa --apply para escribir.");
