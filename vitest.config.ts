import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "mcp/src/**/*.test.ts",
    ],
    // 178 archivos con jsdom en un portátil de 8 GB que además corre IDE y
    // navegadores: con un worker por núcleo, un pico de memoria mata workers y
    // la corrida falla en archivos que no tienen nada que ver (visto el
    // 2026-10-22: 6 archivos y 18 pruebas caídas de golpe, sin reproducirse
    // después). Cuatro workers es estable y cuesta poco tiempo.
    maxWorkers: 4,
    // El timeout es un detector de cuelgues, no una puerta de rendimiento:
    // 5 s (el valor por defecto) es poco para montar árboles de React con
    // act cuando la máquina está cargada.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/shared/**/*.ts", "src/client/lib/**/*.ts", "mcp/src/**/*.ts"],
      // index.ts es el arranque stdio del MCP: se prueba a mano, no en unit.
      exclude: ["**/*.test.ts", "src/client/types/**", "mcp/src/index.ts"],
      thresholds: {
        lines: 75,
        functions: 72,
        "src/shared/**": {
          lines: 85,
          functions: 90,
        },
        "src/client/lib/**": {
          lines: 75,
          functions: 72,
        },
        // Fase 6: suelo por archivo para que no vuelvan a bajar.
        "src/client/lib/use-page-gesture.ts": {
          lines: 85,
          functions: 80,
        },
        "src/client/lib/page-gesture.ts": {
          branches: 60,
        },
        "mcp/src/api.ts": {
          lines: 50,
          functions: 50,
        },
        "mcp/src/tools.ts": {
          lines: 70,
          functions: 60,
        },
      },
    },
  },
});
