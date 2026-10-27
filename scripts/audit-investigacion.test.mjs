import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkAnchor,
  checkReachable,
  checkReference,
  renderMarkdown,
  resolveCommit,
  runAudit,
  stripNonUsage,
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
    expect(report.summary.refutedExpected).toBe(0);
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
    expect(theta.betaFromZipf_zipf6).toBe(-2);
    expect(theta.theta_L1_porDefecto).toBe(0);
    expect(theta.theta_L2_porDefecto).toBe(-0.6);
    expect(theta.exporta_escala_vieja).toEqual([]);
    expect(theta.escribe_llave_vieja).toBe(false);
    expect(theta.migracion_resta).toBe(3);
    expect(theta.saveUserTheta_en_calibracion).toBe(0);
    expect(theta.applyPreviewKnownSignal_en_wordPanel).toBe(1);
    expect(theta.sectionWords_usa_7_menos_zipf).toBe(false);
    expect(theta.sectionWords_usa_4_menos_zipf).toBe(true);

    const xp = probe("H7-xp-proxy").observed;
    expect(xp.xp_consulta).toBe(2);
    expect(xp.xp_guardada_rara).toBe(7);
    expect(xp.xp_guardada_comun).toBe(3);
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

  it("distingue el uso real de una reexportación, un comentario y una prueba", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export function foo() { return 1; }\n", "utf8");
    fs.writeFileSync(path.join(dir, "src", "reexport.ts"), 'export {\n  foo,\n} from "./a";\n', "utf8");
    fs.writeFileSync(
      path.join(dir, "src", "comentario.ts"),
      "// foo() se usaba aquí\nexport const x = 1;\n",
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "src", "a.test.ts"), 'import { foo } from "./a";\nfoo();\n', "utf8");

    const sinUsos = checkReachable(dir, { symbol: "foo", definedIn: "src/a.ts" });
    expect(sinUsos.status).toBe("FAIL");
    expect(sinUsos.observed.callers).toEqual([]);

    fs.writeFileSync(
      path.join(dir, "src", "usa.ts"),
      'import { foo } from "./a";\n\nexport const y = foo();\n',
      "utf8",
    );
    const conUso = checkReachable(dir, { symbol: "foo", definedIn: "src/a.ts" });
    expect(conUso.status).toBe("PASS");
    expect(conUso.observed.callers[0]).toMatchObject({ file: "src/usa.ts", line: 3 });
  });

  it("stripNonUsage conserva el número de líneas", () => {
    const texto = [
      "/* uno",
      "   dos",
      "   tres */",
      "const a = 1;",
      'import {',
      "  a,",
      "  b",
      '} from "x";',
    ].join("\n");
    expect(stripNonUsage(texto).split("\n").length).toBe(texto.split("\n").length);
  });

  it("resuelve el SHA del commit auditado", () => {
    expect(resolveCommit(ROOT)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("un veredicto de auditoría refutado se espera y uno viejo cuenta como fallo", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "muestra.ts"), "const a = 1;\n", "utf8");
    const auditVerdict = { status: "REFUTADA", date: "2026-10-26", motivo: "x", evidencia: [] };
    const r1 = {
      id: "r1",
      title: "ancla que falla",
      statement: "el código no dice esto",
      auditVerdict,
      checks: [{ type: "code-anchor", file: "muestra.ts", line: 1, window: 0, expect: "const z" }],
    };
    const r2 = {
      id: "r2",
      title: "ancla que pasa",
      statement: "el código sí dice esto",
      auditVerdict,
      checks: [{ type: "code-anchor", file: "muestra.ts", line: 1, window: 0, expect: "const a" }],
    };
    const claimsPath = path.join(dir, "claims.json");
    fs.writeFileSync(claimsPath, JSON.stringify({ version: 1, claims: [r1, r2], references: {} }), "utf8");

    const report = await runAudit({ root: dir, claimsPath });
    const byId = (id) => report.results.find((result) => result.id === id);
    expect(byId("r1").status).toBe("REFUTED_EXPECTED");
    expect(byId("r2").status).toBe("VERDICT_STALE");
    expect(report.summary.refutedExpected).toBe(1);
    expect(report.summary.fail).toBe(1);
    expect(report.verdict).toBe("FAIL");

    // Otro archivo de registro: el arnés cachea por ruta el texto leído.
    const soloPath = path.join(dir, "claims-solo.json");
    fs.writeFileSync(soloPath, JSON.stringify({ version: 1, claims: [r1], references: {} }), "utf8");
    const soloRefutada = await runAudit({ root: dir, claimsPath: soloPath });
    expect(soloRefutada.verdict).not.toBe("FAIL");
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
