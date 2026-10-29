import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 178 archivos con jsdom en un portátil de 8 GB que además corre IDE y
    // navegadores: con un worker por núcleo, un pico de memoria mata workers y
    // la corrida falla en archivos que no tienen nada que ver (visto el
    // 2026-10-22: 6 archivos y 18 pruebas caídas de golpe, sin reproducirse
    // después). En CI se limita a 2 workers para runners de 2 vCPUs; en local 4 workers.
    maxWorkers: process.env.CI ? 2 : 4,
    // pool: 'forks' garantiza que el sistema operativo reclame la memoria
    // al finalizar suites de jsdom pesadas, evitando fugas de memoria acumuladas.
    pool: "forks",
    // Mitigación transitoria de flakiness en CI mientras se documenta y aísla.
    retry: process.env.CI ? 1 : 0,
    environment: "node",
    projects: [
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/client/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "worker",
          environment: "node",
          include: [
            "src/worker/**/*.test.ts",
            "src/shared/**/*.test.ts",
            "mcp/src/**/*.test.ts",
            "scripts/**/*.test.mjs",
          ],
        },
      },
    ],
    // El timeout es un detector de cuelgues, no una puerta de rendimiento:
    // 5 s (el valor por defecto) es poco para montar árboles de React con
    // act cuando la máquina está cargada.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: [
        "src/shared/**/*.ts",
        "src/client/lib/**/*.ts",
        "src/worker/**/*.ts",
        "mcp/src/**/*.ts",
      ],
      // index.ts es el arranque stdio del MCP: se prueba a mano, no en unit.
      // src/worker/index.ts es el bootstrap de Cloudflare Workers (scheduled + fetch).
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "src/client/types/**",
        "mcp/src/index.ts",
        "src/worker/index.ts",
      ],
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
        "src/worker/**": {
          lines: 70,
          functions: 70,
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
