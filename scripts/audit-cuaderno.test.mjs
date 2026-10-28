import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  CLAIMS,
  PHASES,
  RESEARCH,
  renderBrief,
  renderMarkdown,
  resolveQuote,
  runClaim,
  runCheck,
  titleSimilarity,
} from "./audit-cuaderno.mjs";

const tmpDirs = [];

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lecta-cuaderno-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const FIXTURE = {
  "src/ui.tsx": [
    "<button onClick={startTest}>Empezar</button>", // 1
    "// nada", // 2
    "<button onClick={startStudy}>Estudiar</button>", // 3
    "const due = words.filter((w) => isDue(w.card));", // 4
  ].join("\n"),
};

describe("audit-cuaderno — comprobaciones", () => {
  it("anchor coincide dentro de la ventana y reporta la línea real", () => {
    const root = tmpRepo(FIXTURE);
    const hit = runCheck(root, {
      tipo: "anchor",
      file: "src/ui.tsx",
      line: 2,
      expect: "onClick=\\{startTest\\}",
      window: 2,
    });
    expect(hit.estado).toBe("COINCIDE");
    expect(hit.evidencia.line).toBe(1);
    expect(hit.detalle).toContain("src/ui.tsx:1");
  });

  it("anchor falla si el patrón se fue de la ventana", () => {
    const root = tmpRepo(FIXTURE);
    const miss = runCheck(root, {
      tipo: "anchor",
      file: "src/ui.tsx",
      line: 2,
      expect: "onClick=\\{startLearn\\}",
      window: 1,
    });
    expect(miss.estado).toBe("NO_COINCIDE");
    expect(miss.evidencia.excerpt).toContain("startTest");
  });

  it("presente busca en todo el archivo y reporta la línea real", () => {
    const root = tmpRepo(FIXTURE);
    const hit = runCheck(root, { tipo: "presente", file: "src/ui.tsx", expect: "startStudy" });
    expect(hit.estado).toBe("COINCIDE");
    expect(hit.evidencia.line).toBe(3);
    const miss = runCheck(root, { tipo: "presente", file: "src/ui.tsx", expect: "inventado" });
    expect(miss.estado).toBe("NO_COINCIDE");
    expect(miss.detalle).toContain("no contiene");
  });

  it("ausente coincide solo si el patrón no está en el rango", () => {
    const root = tmpRepo(FIXTURE);
    const limpio = runCheck(root, {
      tipo: "ausente",
      file: "src/ui.tsx",
      from: 3,
      to: 4,
      pattern: "deleted",
    });
    expect(limpio.estado).toBe("COINCIDE");
    const sucio = runCheck(root, {
      tipo: "ausente",
      file: "src/ui.tsx",
      from: 3,
      to: 4,
      pattern: "isDue",
    });
    expect(sucio.estado).toBe("NO_COINCIDE");
    expect(sucio.evidencia.hits[0].line).toBe(4);
  });

  it("orden distingue «estudio antes que prueba» de lo contrario", () => {
    const root = tmpRepo(FIXTURE);
    const bien = runCheck(root, {
      tipo: "orden",
      file: "src/ui.tsx",
      antes: { line: 1, expect: "startTest" },
      despues: { line: 3, expect: "startStudy" },
    });
    expect(bien.estado).toBe("COINCIDE");
    const mal = runCheck(root, {
      tipo: "orden",
      file: "src/ui.tsx",
      antes: { line: 3, expect: "startStudy" },
      despues: { line: 1, expect: "startTest" },
    });
    expect(mal.estado).toBe("NO_COINCIDE");
  });
});

describe("audit-cuaderno — agregación por afirmación", () => {
  const claim = {
    id: "T1",
    tipo: "defecto",
    titulo: "prueba",
    porque: "porque",
    checks: [
      { tipo: "anchor", file: "src/ui.tsx", line: 1, expect: "startTest" },
      { tipo: "anchor", file: "src/ui.tsx", line: 3, expect: "startStudy" },
    ],
  };

  it("CONFIRMADO si todas las comprobaciones coinciden", () => {
    const root = tmpRepo(FIXTURE);
    expect(runClaim(root, claim).estado).toBe("CONFIRMADO");
  });

  it("PARCIAL si solo una coincide (registro desactualizado a medias)", () => {
    const root = tmpRepo(FIXTURE);
    const parcial = {
      ...claim,
      checks: [claim.checks[0], { ...claim.checks[1], expect: "startNada" }],
    };
    const result = runClaim(root, parcial);
    expect(result.estado).toBe("PARCIAL");
    expect(result.coincidencias).toBe("1/2");
  });

  it("MOVIDO si ninguna coincide: el código cambió y hay que revisar", () => {
    const root = tmpRepo(FIXTURE);
    const movido = {
      ...claim,
      checks: [
        { tipo: "anchor", file: "src/ui.tsx", line: 1, expect: "inventado" },
        { tipo: "anchor", file: "src/ui.tsx", line: 3, expect: "tampoco" },
      ],
    };
    expect(runClaim(root, movido).estado).toBe("MOVIDO");
  });

  it("una afirmación «corregido» se reporta CORREGIDO o REGRESION, no CONFIRMADO", () => {
    const root = tmpRepo(FIXTURE);
    const arreglo = { ...claim, tipo: "corregido" };
    expect(runClaim(root, arreglo).estado).toBe("CORREGIDO");
    const regresion = {
      ...arreglo,
      checks: [
        { tipo: "anchor", file: "src/ui.tsx", line: 1, expect: "inventado" },
        { tipo: "anchor", file: "src/ui.tsx", line: 3, expect: "tampoco" },
      ],
    };
    expect(runClaim(root, regresion).estado).toBe("REGRESION");
  });
});

describe("audit-cuaderno — citas", () => {
  const cita = {
    autor: "Webb",
    anio: 2007,
    titulo: "The effects of repetition on vocabulary knowledge",
    revista: "Applied Linguistics",
    doi: "10.1093/applin/aml048",
  };

  const respuesta = (extra = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({
      message: {
        DOI: cita.doi,
        title: [cita.titulo],
        issued: { "date-parts": [[2007]] },
        ...extra,
      },
    }),
  });

  afterAll(() => vi.unstubAllGlobals());

  it("titleSimilarity compara palabras normalizadas, no caracteres", () => {
    expect(
      titleSimilarity(
        "The effects of repetition on vocabulary knowledge",
        "The Effects of Repetition on Vocabulary Knowledge.",
      ),
    ).toBe(1);
    expect(titleSimilarity("Cognitive load during problem solving", "User interface design")).toBe(0);
  });

  it("resuelve por DOI cuando el título y el año coinciden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta()));
    const r = await resolveQuote({ cita, buscar: "x" });
    expect(r.estado).toBe("RESUELTA");
    expect(r.doi).toBe(cita.doi);
    vi.unstubAllGlobals();
  });

  it("marca DUDOSA si la obra devuelta no es la citada (mismo título, otro año)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta({ issued: { "date-parts": [[2026]] } })),
    );
    const r = await resolveQuote({ cita, buscar: "x" });
    expect(r.estado).toBe("DUDOSA");
    expect(r.coincideAnio).toBe(false);
    vi.unstubAllGlobals();
  });

  it("marca DUDOSA si el título es otro aunque el año coincida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta({ title: ["Learning the hard way: Need for Cognition"] })),
    );
    const r = await resolveQuote({ cita, buscar: "x" });
    expect(r.estado).toBe("DUDOSA");
    vi.unstubAllGlobals();
  });

  it("no consulta Crossref para capítulos sin DOI ni guías", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await resolveQuote({ cita: { ...cita, sinDoi: true }, buscar: "x" })).estado).toBe(
      "SIN_DOI",
    );
    expect((await resolveQuote({ cita: { ...cita, tipo: "guia" }, buscar: "x" })).estado).toBe(
      "SIN_DOI",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("audit-cuaderno — registro", () => {
  it("los ids son únicos y toda afirmación tiene comprobaciones", () => {
    const ids = CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const claim of CLAIMS) {
      expect(claim.checks.length).toBeGreaterThan(0);
      expect(["defecto", "contexto", "corregido"]).toContain(claim.tipo);
      expect(claim.porque.length).toBeGreaterThan(10);
    }
  });

  it("cada pregunta de investigación trae cita y consulta verificable", () => {
    for (const item of RESEARCH) {
      expect(item.buscar.length).toBeGreaterThan(10);
      expect(item.cita.autor.length).toBeGreaterThan(3);
      expect(item.cita.anio).toBeGreaterThan(1980);
      expect(item.queAtacar.length).toBeGreaterThan(20);
    }
  });

  it("las fases van F0→F5, cada una con archivos, aceptación y puerta", () => {
    expect(PHASES.map((p) => p.id)).toEqual(["F0", "F1", "F2", "F3", "F4", "F5"]);
    for (const phase of PHASES) {
      expect(phase.archivos.length).toBeGreaterThan(0);
      expect(phase.aceptacion.length).toBeGreaterThan(0);
      expect(phase.puerta.length).toBeGreaterThan(5);
      expect(phase.riesgo.length).toBeGreaterThan(10);
    }
  });
});

describe("audit-cuaderno — render", () => {
  const report = {
    generado: "2026-10-28T00:00:00.000Z",
    commit: "abc123",
    resumen: { total: 1, confirmadas: 1, parciales: 0, movidas: 0 },
    claims: [
      {
        id: "C1",
        tipo: "defecto",
        titulo: "CTA abre prueba",
        porque: "porque",
        estado: "CONFIRMADO",
        checks: [
          {
            tipo: "anchor",
            estado: "COINCIDE",
            detalle: "src/ui.tsx:1 ~ /startTest/",
            evidencia: { file: "src/ui.tsx", line: 1, text: "<button onClick={startTest}>" },
          },
        ],
      },
    ],
    research: [
      {
        id: "R1",
        cuestion: "¿presentar antes?",
        cita: { autor: "A", anio: 2006, titulo: "T", revista: "R" },
        porQue: "p",
        queAtacar: "q",
      },
    ],
    phases: PHASES,
  };

  it("el markdown trae las secciones que usa la sesión que implementa", () => {
    const md = renderMarkdown(report);
    for (const seccion of [
      "## La queja, en palabras del usuario",
      "## Veredicto",
      "## Afirmaciones",
      "## Preguntas de investigación",
      "## Encargo por fases",
      "src/ui.tsx:1",
    ]) {
      expect(md).toContain(seccion);
    }
  });

  it("el brief dice qué defecto está confirmado y con qué archivo:línea", () => {
    const brief = renderBrief(report);
    expect(brief).toContain("C1: CTA abre prueba");
    expect(brief).toContain("src/ui.tsx:1");
    expect(brief).toContain("Regla de oro");
    expect(brief).toContain("F0");
  });
});
