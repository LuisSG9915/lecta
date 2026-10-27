// El resumen que se imprime cuando el gate falla en pruebas. Lo que se prueba
// aquí es el parser del log: si Vitest cambia el formato, esto se entera antes
// que una tarde de diagnóstico perdida.
import { describe, expect, it } from "vitest";
import { formatSummary, summarizeVitestLog } from "./test-trace.mjs";

// Recorte real de una salida de Vitest con un fallo (formato observado en el
// repo el 2026-10-26).
const LOG_CON_FALLO = `
 ❯ src/client/components/CompanionPanel.test.ts (29 tests | 1 failed) 1360ms
   ✓ lleva el nombre del gato en el rótulo y el nivel en la cabecera 48ms
   × con un libro abierto, el armario viste para ese libro y lo recuerda 41ms
     → expected undefined to be 'boina'

⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯

 FAIL  src/client/components/CompanionPanel.test.ts > CompanionPanel > con un libro abierto, el armario viste para ese libro y lo recuerda
AssertionError: expected undefined to be 'boina'
 ❯ src/client/components/CompanionPanel.test.ts:601:7

 Test Files  1 failed | 185 passed (186)
      Tests  1 failed | 2632 passed (2633)
`;

const LOG_LIMPIO = `
 ✓ src/client/lib/companion-closet.test.ts (33 tests) 12ms

 Test Files  186 passed (186)
      Tests  2633 passed (2633)
`;

const LOG_CON_WORKER_MUERTO = `
 Unhandled Error: Worker exited unexpectedly
Serialized Error: { code: 'ERR_WORKER_OUT_OF_MEMORY' }
 Test Files  1 failed | 185 passed (186)
`;

describe("resumen de la salida de Vitest", () => {
  it("saca archivo y prueba de una línea con «×» y de un bloque FAIL", () => {
    const s = summarizeVitestLog(LOG_CON_FALLO);
    // El archivo se reconoce por la cabecera «❯ … (29 tests | 1 failed)» y por
    // el bloque FAIL; la prueba, por el bloque FAIL (que sí trae la ruta).
    expect(s.files).toEqual(["src/client/components/CompanionPanel.test.ts"]);
    expect(s.tests).toHaveLength(1);
    expect(s.tests[0]).toContain("con un libro abierto");
    expect(s.tests[0]).not.toMatch(/\d+ms$/);
    expect(s.counts).toBe("1 failed | 2632 passed (2633)");
  });

  it("no inventa fallos cuando todo pasa", () => {
    const s = summarizeVitestLog(LOG_LIMPIO);
    expect(s.files).toEqual([]);
    expect(s.tests).toEqual([]);
    expect(s.counts).toBe("2633 passed (2633)");
  });

  it("reconoce un worker caído aunque no haya prueba con nombre", () => {
    const s = summarizeVitestLog(LOG_CON_WORKER_MUERTO);
    expect(s.files).toEqual([]);
    expect(s.tests.join(" ")).toContain("Worker exited unexpectedly");
  });

  it("el texto para la terminal dice qué mirar", () => {
    const s = summarizeVitestLog(LOG_CON_FALLO);
    const texto = formatSummary(s, "/tmp/log.log");
    expect(texto).toContain("Tests: 1 failed");
    expect(texto).toContain("src/client/components/CompanionPanel.test.ts");
    expect(texto).toContain("Pruebas fallidas:");
    expect(texto).toContain("/tmp/log.log");
  });
});
