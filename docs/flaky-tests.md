# Registro y Gestión de Flaky Tests en Lecta

Este documento define la política oficial del equipo de ingeniería para la detección, aislamiento y remediación de pruebas intermitentes (*flaky tests*) en la suite de pruebas automatizadas de Lecta.

---

## 1. Política de Estabilidad

> **Regla de oro:**
> *"3 retries en 2 semanas -> se aisla con fixme y se corrige"*

1. **Mitigación transitoria en CI:**
   - La suite en GitHub Actions ejecuta Vitest con `retry: 1` (`vitest.config.ts`), permitiendo mitigar fallos transitorios atribuibles a variabilidad de scheduling en runners con 2 vCPUs sin bloquear despliegues críticos.
   - En entornos locales de desarrollo, `retry` permanece en `0` para que cualquier fallo se manifieste de forma inmediata.

2. **Detección y Registro:**
   - Si una prueba pasa únicamente en el segundo intento (reintento) o falla de forma intermitente en CI/local, el desarrollador o responsable de guardia debe registrar el incidente en la tabla de seguimiento.

3. **Criterio de Aislamiento:**
   - Si una prueba acumula **3 retries o fallos en una ventana de 2 semanas**, la prueba **debe marcarse inmediatamente como aislada** usando `test.fixme(...)` o `it.fixme(...)`.
   - Se prohíbe el uso de `test.skip` sin contexto: `test.fixme` señala explícitamente una prueba rota pendiente de arreglo.
   - Toda prueba marcada con `fixme` debe enlazar a una entrada en este documento y un issue o tarea de resolución prioritaria.

4. **Remediación:**
   - Se debe identificar la causa raíz y refactorizar la prueba o el código de producción bajo prueba.
   - Una vez estabilizada (validada con `vitest run --repeat 10` sin fallos), se remueve el `.fixme` y se actualiza el estado a `Resuelto` en este registro.

---

## 2. Taxonomía de Causas Raíz

| Categoría | Manifestación Típica | Estrategia de Solución |
|---|---|---|
| **Timer** | `setTimeout`, `setInterval`, desfases con `vi.useFakeTimers()`, microtasks pendientes tras `act()`, o asunciones de reloj de pared en máquinas lentas. | Usar `vi.runAllTimers()`, `vi.advanceTimersByTime()`, o sustituir timeouts fijos por polling determinista con `waitFor(...)`. |
| **JSDOM** | Fugas de memoria del DOM emulado, APIs de navegador inexistentes o mockeadas a medias (`HTMLCanvasElement`, `matchMedia`, `IntersectionObserver`, `AudioContext`), o eventos de ventana persistentes entre tests. | Limpieza estricta en `afterEach`, mocks robustos en `setupFiles`, o delegar suites puras de backend/worker a entorno `'node'`. |
| **Race Condition** | Transacciones concurrentes en IndexedDB (`idb`), mutaciones sin esperar promesas (`missing await`), orden impredecible de eventos o reconciliación de React 19. | Encadenar promesas correctamente, sincronizar transacciones IDB y envolver actualizaciones de estado en `act(async () => ...)`. |

---

## 3. Plantilla de Registro

Al documentar un nuevo caso, añade una fila a la tabla usando la siguiente estructura:

| Campo | Descripción |
|---|---|
| **Archivo** | Ruta relativa al archivo de prueba (`src/...`) |
| **Test** | Nombre completo del bloque `describe > test` |
| **Causa Raíz** | `Timer`, `JSDOM`, o `Race Condition` (con breve explicación técnica) |
| **Estado** | `Bajo Observación`, `Aislado (fixme)`, o `Resuelto` |
| **Fecha de Detección** | Fecha ISO (YYYY-MM-DD) del primer incidente registrado |
| **Reintentos (2 sem)** | Contador de reintentos observados en las últimas 2 semanas |
| **Notas / PR** | Enlace al PR de fix, issue o detalles adicionales |

---

## 4. Tabla de Seguimiento Activa

| Archivo | Test | Causa Raíz | Estado | Fecha Detección | Reintentos (2 sem) | Notas / PR |
|---|---|---|---|---|---|---|
| *(Ejemplo / Plantilla)* | *`src/client/example.test.ts` > `caso intermitente`* | *Timer: debounce sin drenar microtasks* | *Resuelto* | *2026-10-28* | *1* | *Drenado con `vi.runAllTimers()`* |

*(Actualmente la suite corre sin pruebas aisladas con `fixme`)*.

---

## 5. Línea Base de Estabilidad y Presupuesto de CI (Fase 1)

### Métricas de Línea Base Inicial (2026-10-28)
- **Suite Vitest:** 205 archivos de prueba, 2825 tests unitarios e integrados.
- **Tasa de Flakiness en Vitest:** **0.0%** (0 pruebas aisladas con `.fixme`).
- **Aislamiento de entornos:** `node` estricto para worker/shared/mcp y `jsdom` acotado al cliente, eliminando fugas de memoria y desbordamiento de heap.
- **Suite E2E Playwright:** 3 recorridos críticos (`e2e/smoke-journeys.spec.ts`) con hidratación determinista y mitigación de llamadas a navegadores headless.
- **Línea Base de Tiempos de CI (Presupuesto máximo: ≤ 12 minutos):**
  - Job `static` (Typecheck + Lint): ~1 min.
  - Job `unit` (Cobertura Vitest): ~3 min.
  - Job `build` (Compilación Vite + Size check): ~1.5 min.
  - Job `e2e` (Playwright con caché de navegadores): ~3–4 min.
  - **Tiempo total estimado en pared (paralelo):** ~5.5–6 minutos (50% por debajo del presupuesto máximo de 12 min).

### Política de Protección de Ramas (Branch Protection)
Para garantizar la integridad del repositorio y permitir que Dependabot opere sin riesgo:
1. Las ramas principales (`main`) deben requerir paso obligatorio (*blocking*) de los 4 jobs de CI:
   - `Static Analysis (Typecheck & Lint)`
   - `Unit & Integration Tests (Coverage)`
   - `Production Build & Size Check`
   - `End-to-End Tests (Playwright)`
2. No se permiten fusiones directas sin PR ni aprobaciones si el gate de cobertura ratchet (< 70% en worker) o el size budget (> 215 kB) resultan violados.
