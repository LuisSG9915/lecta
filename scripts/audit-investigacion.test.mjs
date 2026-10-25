import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkAnchor,
  checkReference,
  renderMarkdown,
  runAudit,
  writePack,
} from "./audit-investigacion.mjs";

const ROOT = process.cwd();
const tmpDirs = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lecta-auditoria-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("audit-investigacion", () => {
  it("aprueba todos los anclajes y sondas del registro sin red", async () => {
    const report = await runAudit({ root: ROOT });
    expect(report.summary.claims).toBe(14);
    expect(report.summary.fail).toBe(0);
    expect(report.summary.codeFail).toBe(0);
    expect(report.summary.codePass).toBe(14);
    // Sin red las referencias quedan pendientes, nunca aprobadas por defecto.
    expect(report.summary.referenceUnverified).toBeGreaterThan(0);
    expect(report.verdict).toBe("PASS_WITH_UNVERIFIED");
  }, 60_000);

  it("las sondas observan los valores que afirma el documento", async () => {
    const report = await runAudit({ root: ROOT });
    const probe = (id) =>
      report.results
        .find((result) => result.id === id)
        .checks.find((check) => check.kind === "probe");
    const theta = probe("H3-theta-escala").observed;
    expect(theta.wordDifficulty_zipf6).toBe(1);
    expect(theta.betaFromZipf_zipf6).toBe(-2);
    expect(theta.desfase_logits_zipf6).toBe(3);
    expect(theta.zpd_vivo_zipf_con_theta4).toBeCloseTo(2.35, 1);
    expect(theta.zpd_vivo_zipf_con_theta1).toBeCloseTo(5.35, 1);
    expect(theta.zpd_escenarioA_devuelve_vacio).toBe(true);

    const dwell = probe("H5-pasiva").observed;
    expect(dwell.saturacion_desde_palabras).toBe(75);
    expect(dwell.requerido_250_palabras).toBe(12_000);

    const xp = probe("H7-xp-proxy").observed;
    expect(xp.xp_consulta).toBe(2);
    expect(xp.xp_guardada_rara).toBe(7);
    expect(xp.xp_guardada_comun).toBe(3);

    const fsrs = probe("H6-fsrs-manual").observed;
    expect(fsrs.params_manuales.reader_tap.stability).toBe(1);
    expect(fsrs.desvio_reader_tap).not.toBe(0);
    expect(fsrs.multiplicador_episodico).toBe("presente");

    const bank = probe("H3-cat-prior").observed;
    expect(bank.prior_theta).toBe(4);
    expect(bank.min).toBeLessThan(-2);
    expect(bank.max).toBeGreaterThan(2);
    expect(bank.info_fisher_maxima).toBeLessThan(0.3);
  }, 60_000);

  it("detecta un anclaje roto en vez de dar por buena la cita", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "muestra.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
    const ok = checkAnchor(dir, { file: "muestra.ts", line: 2, window: 1, expect: "const b" });
    expect(ok.status).toBe("PASS");
    const roto = checkAnchor(dir, { file: "muestra.ts", line: 2, window: 1, expect: "const z" });
    expect(roto.status).toBe("FAIL");
    expect(roto.observed.excerpt.join("\n")).toContain("const b = 2;");
  });

  it("refuta un registro con una afirmación imposible", async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "doc.md"), "texto de prueba\n", "utf8");
    fs.writeFileSync(path.join(dir, "muestra.ts"), "const a = 1;\n", "utf8");
    const claims = {
      version: 1,
      claims: [
        {
          id: "X1",
          title: "Afirmación falsa",
          statement: "dice algo que el código no hace",
          docQuote: "texto de prueba",
          checks: [{ type: "code-anchor", file: "muestra.ts", line: 1, expect: "const inexistente" }],
        },
      ],
      references: {},
    };
    const claimsPath = path.join(dir, "claims.json");
    fs.writeFileSync(claimsPath, JSON.stringify(claims), "utf8");
    const report = await runAudit({ root: dir, claimsPath, docRel: "docs/doc.md" });
    expect(report.verdict).toBe("FAIL");
    expect(report.results[0].status).toBe("FAIL");
    expect(report.results[0].codeStatus).toBe("FAIL");
  });

  it("valida la forma de la referencia y contrasta metadatos con Crossref", async () => {
    const malo = await checkReference({ id: "x", cite: "X", doi: "no-es-un-doi", level: "meta-análisis" });
    expect(malo.status).toBe("FAIL");

    const sinRed = await checkReference({
      id: "x",
      cite: "X",
      doi: "10.1037/a0037559",
      level: "meta-análisis",
    });
    expect(sinRed.status).toBe("UNVERIFIED");

    const fetchOk = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          title: ["The effect of testing versus restudy on retention"],
          issued: { "date-parts": [[2014]] },
        },
      }),
    });
    const bueno = await checkReference(
      {
        id: "rowland2014",
        cite: "Rowland (2014)",
        doi: "10.1037/a0037559",
        level: "meta-análisis",
        titleIncludes: ["testing versus restudy"],
        yearAnyOf: [2014],
      },
      { online: true, fetchImpl: fetchOk },
    );
    expect(bueno.status).toBe("PASS");

    const fetchMalTitulo = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { title: ["Otro artículo"], issued: { "date-parts": [[2014]] } } }),
    });
    const malTitulo = await checkReference(
      {
        id: "rowland2014",
        cite: "Rowland (2014)",
        doi: "10.1037/a0037559",
        level: "meta-análisis",
        titleIncludes: ["testing versus restudy"],
        yearAnyOf: [2014],
      },
      { online: true, fetchImpl: fetchMalTitulo },
    );
    expect(malTitulo.status).toBe("FAIL");
  });

  it("renderiza el reporte y exporta un paquete con hashes", async () => {
    const report = await runAudit({ root: ROOT, only: ["H5-pasiva"] });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("Veredicto");
    expect(markdown).toContain("H5-pasiva");
    expect(markdown).toContain("Código:");

    const packDir = tmpDir();
    const manifest = writePack(report, ROOT, packDir);
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const file of manifest.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(packDir, "claims.json"))).toBe(true);
    expect(fs.existsSync(path.join(packDir, "reporte.md"))).toBe(true);
    expect(fs.existsSync(path.join(packDir, "manifest.json"))).toBe(true);
  }, 60_000);
});
