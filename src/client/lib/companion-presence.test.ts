// Pruebas del planificador puro de presencia: toda la tabla cerrada
// por modo («visits», «playful», «always», «off») con tiempos falsos —
// cada señal lleva su `at`, nada depende de timers reales.
import { describe, expect, it } from "vitest";
import { createPresence } from "./companion-presence";
import type { ReadingPresence } from "../../shared/companion-data";

type Probe = ReturnType<typeof createPresence> & { log: boolean[] };

// El lector listo y en lectura: modo + ready + no-idle. El resto de
// señales se ejercita por prueba.
const make = (mode: ReadingPresence): Probe => {
  const log: boolean[] = [];
  const p = createPresence({ mode, onChange: (v) => log.push(v) });
  p.ready(true, 0);
  p.idle(false, 0);
  return Object.assign(p, { log });
};

describe("createPresence", () => {
  it("visits: primera visita al minuto de actividad elegible", () => {
    const p = make("visits");
    p.active(59_999, 1_000);
    expect(p.visible).toBe(false);
    p.active(1, 2_000);
    expect(p.visible).toBe(true);
    expect(p.log).toEqual([true]);
  });

  it("visits: la visita dura 15 segundos y se cierra con el latido", () => {
    const p = make("visits");
    p.active(60_000, 1_000); // visita abierta, termina en 16_000
    p.tick(15_999);
    expect(p.visible).toBe(true);
    p.tick(16_000);
    expect(p.visible).toBe(false);
    expect(p.log).toEqual([true, false]);
  });

  it("visits: la separación entre visitas corre en tiempo elegible", () => {
    const p = make("visits");
    p.active(60_000, 1_000); // primera visita al minuto
    p.tick(16_000); // cierra: eligible quedó en 60_000
    // No dispara aunque pase reloj de pared sin actividad elegible:
    for (let t = 17_000; t < 400_000; t += 10_000) p.tick(t);
    expect(p.visible).toBe(false);
    // 3 minutos elegibles después del cierre:
    p.active(179_999, 400_000);
    expect(p.visible).toBe(false);
    p.active(1, 401_000);
    expect(p.visible).toBe(true);
  });

  it("playful: primera visita a los 30 s, dura 15 s, separación de 90 s", () => {
    const p = make("playful");
    p.active(29_999, 1_000);
    expect(p.visible).toBe(false);
    p.active(1, 2_000); // abre; termina en 17_000
    expect(p.visible).toBe(true);
    p.tick(16_999);
    expect(p.visible).toBe(true);
    p.tick(17_000);
    expect(p.visible).toBe(false);
    // Separación: 90 s elegibles desde el cierre (eligible = 30_000).
    p.active(89_999, 20_000);
    expect(p.visible).toBe(false);
    p.active(1, 21_000);
    expect(p.visible).toBe(true);
  });

  it("always: visible con la lectura lista, sin umbrales ni duración", () => {
    const p = make("always");
    expect(p.visible).toBe(true); // ready + sin bloqueos
    p.idle(true, 1_000);
    expect(p.visible).toBe(true); // quieta, pero presente
    p.machine("deep_focus", 2_000);
    expect(p.visible).toBe(true); // el foco profundo no la retira
    p.hidden(true, 3_000);
    expect(p.visible).toBe(false);
    p.hidden(false, 4_000);
    expect(p.visible).toBe(true);
  });

  it("off: nunca visible aunque haya actividad elegible", () => {
    const p = make("off");
    p.active(600_000, 1_000);
    for (let t = 2_000; t < 600_000; t += 10_000) p.tick(t);
    expect(p.visible).toBe(false);
    expect(p.log).toEqual([]);
  });

  it("hidden congela el acumulado y apaga la visita al volver", () => {
    const p = make("visits");
    p.active(30_000, 1_000);
    p.hidden(true, 2_000);
    p.active(300_000, 3_000); // oculto: no cuenta
    p.tick(100_000);
    p.hidden(false, 200_000);
    expect(p.visible).toBe(false);
    // La espera continúa desde donde quedó, sin deuda.
    p.active(29_999, 201_000);
    expect(p.visible).toBe(false);
    p.active(1, 202_000);
    expect(p.visible).toBe(true);
  });

  it("overlay pausa la visita y la retoma al liberarse", () => {
    const p = make("visits");
    p.active(60_000, 1_000); // visita abierta hasta 16_000
    expect(p.visible).toBe(true);
    p.overlay(true, 2_000); // una hoja lo cubre: pausa, le quedan 14 s
    expect(p.visible).toBe(false);
    p.active(1_000, 3_000); // bajo hoja no cuenta
    p.overlay(false, 4_000); // retoma lo que le quedaba
    expect(p.visible).toBe(true);
    p.tick(17_999);
    expect(p.visible).toBe(true);
    p.tick(18_000); // cumple sus 14 s restantes desde la liberación
    expect(p.visible).toBe(false);
    // La próxima visita pide el cooldown elegible desde el cierre
    // real (eligible quedó en 60_000).
    p.active(179_999, 19_000);
    expect(p.visible).toBe(false);
    p.active(1, 20_000);
    expect(p.visible).toBe(true);
  });

  it("idle pausa la visita y la retoma al despertar", () => {
    const p = make("visits");
    p.active(60_000, 1_000); // visita hasta 16_000
    expect(p.visible).toBe(true);
    p.idle(true, 2_000); // pausa con 14 s restantes
    expect(p.visible).toBe(false);
    p.active(50_000, 3_000); // inactivo: no cuenta
    p.idle(false, 4_000); // despierta: retoma los 14 s
    expect(p.visible).toBe(true);
    p.tick(17_999);
    expect(p.visible).toBe(true);
    p.tick(18_000);
    expect(p.visible).toBe(false);
    // El cooldown corre desde el cierre real de la visita.
    p.active(179_999, 19_000);
    expect(p.visible).toBe(false);
    p.active(1, 20_000);
    expect(p.visible).toBe(true);
  });

  it("suppress silencia sin tocar la preferencia ni acumular", () => {
    const p = make("visits");
    p.active(30_000, 1_000);
    p.suppress(true, 2_000);
    p.active(300_000, 3_000); // suprimido: no cuenta
    p.tick(100_000);
    expect(p.visible).toBe(false);
    expect(p.log).toEqual([]);
    p.suppress(false, 200_000);
    p.active(29_999, 201_000);
    expect(p.visible).toBe(false);
    p.active(1, 202_000);
    expect(p.visible).toBe(true);
  });

  it("deep_focus difiere sin acumular: la espera continúa al salir", () => {
    const p = make("visits");
    p.active(30_000, 1_000); // faltan 30 s para la visita
    p.machine("deep_focus", 2_000);
    p.active(300_000, 3_000); // en foco profundo no cuenta ni dispara
    p.tick(100_000);
    expect(p.visible).toBe(false);
    p.machine("reading", 200_000);
    // Al salir no se dispara por lo acumulado: faltan 30 s elegibles.
    expect(p.visible).toBe(false);
    p.active(29_999, 201_000);
    expect(p.visible).toBe(false);
    p.active(1, 202_000);
    expect(p.visible).toBe(true);
  });

  it("deep_focus no corta una visita ya abierta", () => {
    const p = make("visits");
    p.active(60_000, 1_000); // visita hasta 16_000
    p.machine("deep_focus", 2_000);
    expect(p.visible).toBe(true);
    p.tick(16_000);
    expect(p.visible).toBe(false);
  });

  it("cambio de modo se aplica inmediatamente", () => {
    const p = make("visits");
    p.active(60_000, 1_000);
    expect(p.visible).toBe(true);
    p.mode("off", 2_000); // apaga al instante
    expect(p.visible).toBe(false);
    p.mode("always", 3_000); // entra sin esperar
    expect(p.visible).toBe(true);
    p.mode("off", 4_000);
    p.mode("visits", 5_000); // al volver, no hay visita abierta heredada
    expect(p.visible).toBe(false);
  });

  it("reset reinicia por libro: acumulado, visita y supresión", () => {
    const p = make("visits");
    p.active(60_000, 1_000);
    p.suppress(true, 2_000);
    p.reset(3_000);
    // Como si el libro se cerrara y abriera otro: espera completa de
    // nuevo, sin supresión heredada (pero sigue inactivo hasta que
    // llegue la siguiente señal real).
    expect(p.visible).toBe(false);
    p.idle(false, 4_000);
    p.active(59_999, 5_000);
    expect(p.visible).toBe(false);
    p.active(1, 6_000);
    expect(p.visible).toBe(true);
  });

  it("saluda al abrir el libro sin esperar actividad elegible", () => {
    const p = createPresence({ mode: "visits" });
    p.ready(true, 0); // idle sigue true: aún no hay señales
    p.greet(1_000);
    expect(p.visible).toBe(true);
    expect(p.greeting).toBe(true);
    p.tick(10_999);
    expect(p.visible).toBe(true);
    p.tick(11_000); // el saludo caduca a los 10 s de reloj
    expect(p.visible).toBe(false);
    expect(p.greeting).toBe(false);
  });

  it("el saludo es una vez por libro y no gasta el cooldown elegible", () => {
    const p = make("visits");
    p.greet(1_000);
    p.tick(11_000); // saludo cerrado
    p.greet(12_000); // ya saludó en esta lectura: no repite
    expect(p.visible).toBe(false);
    // La primera visita real sigue pidiendo el primer umbral, no el
    // cooldown desde el cierre del saludo.
    p.active(59_999, 13_000);
    expect(p.visible).toBe(false);
    p.active(1, 14_000);
    expect(p.visible).toBe(true);
    expect(p.greeting).toBe(false); // visita normal, no saludo
    // Tras reset (otro libro) vuelve a saludar.
    p.reset(30_000);
    p.idle(false, 31_000);
    p.greet(32_000);
    expect(p.visible).toBe(true);
    expect(p.greeting).toBe(true);
  });

  it("saludo bajo capa queda pendiente y se dispara al liberarse", () => {
    const p = make("visits");
    p.suppress(true, 0);
    p.greet(1_000); // suprimido: pendiente, no perdido
    expect(p.visible).toBe(false);
    p.suppress(false, 2_000); // al liberarse la lectura, saluda
    expect(p.visible).toBe(true);
    expect(p.greeting).toBe(true);
    p.greet(3_000); // ya saludó en esta lectura: no reinicia
    p.overlay(true, 4_000); // una hoja encima pausa el saludo
    expect(p.visible).toBe(false);
    p.overlay(false, 5_000); // retoma lo que le quedaba (abierto a las 2 s)
    expect(p.visible).toBe(true);
    expect(p.greeting).toBe(true);
    p.tick(13_000); // cumple sus 10 s contando la pausa
    expect(p.visible).toBe(false);
  });

  it("reacciona a un momento del lector aunque no toque visita", () => {
    const p = make("visits");
    p.react(1_000); // sin elegible: asoma a responder
    expect(p.visible).toBe(true);
    expect(p.greeting).toBe(false); // no es saludo
    p.tick(10_999);
    expect(p.visible).toBe(true);
    p.tick(11_000); // la reacción caduca a los 10 s de reloj
    expect(p.visible).toBe(false);
  });

  it("reacción: enfriamiento propio de 90 s y no gasta el de visitas", () => {
    const p = make("visits");
    p.react(1_000);
    p.tick(11_000); // reacción cerrada
    p.react(12_000); // dentro de los 90 s: no asoma de nuevo
    expect(p.visible).toBe(false);
    p.react(91_001); // enfriamiento cumplido: sí responde
    expect(p.visible).toBe(true);
    p.tick(101_001); // cerrada
    // La primera visita real sigue pidiendo el umbral completo: la
    // reacción no movió el acumulado ni el cooldown elegible.
    p.active(59_999, 102_000);
    expect(p.visible).toBe(false);
    p.active(1, 103_000);
    expect(p.visible).toBe(true);
  });

  it("reacción durante el saludo espera detrás y responde al acabar", () => {
    const p = make("visits");
    p.greet(1_000);
    p.react(2_000); // el saludo sigue; el momento queda pendiente
    expect(p.greeting).toBe(true);
    p.tick(11_000); // termina el saludo: la reacción responde fresca
    expect(p.greeting).toBe(false);
    expect(p.visible).toBe(true); // asoma enseguida, aún con eco
  });

  it("reacción durante una visita responde al cerrarse", () => {
    const p = make("visits");
    p.active(60_000, 1_000); // visita abierta hasta 16_000
    p.react(2_000); // pendiente detrás de la visita
    p.tick(16_000); // cierra la visita: responde el momento fresco
    expect(p.visible).toBe(true);
    p.tick(26_000);
    expect(p.visible).toBe(false);
  });

  it("reacción cortada al nacer por una capa responde al liberarse", () => {
    const p = make("visits");
    p.react(1_000); // asoma a responder
    expect(p.visible).toBe(true);
    // La consulta abre su ficha en el mismo gesto: la capa la corta
    // a los 500 ms y queda pendiente, no perdida.
    p.overlay(true, 1_500);
    expect(p.visible).toBe(false);
    p.overlay(false, 8_000); // cierra la consulta: responde fresco
    expect(p.visible).toBe(true);
    p.tick(17_999);
    expect(p.visible).toBe(true);
    p.tick(18_000); // ventana completa de 10 s desde la liberación
    expect(p.visible).toBe(false);
  });

  it("reacción ya tapada queda pendiente y la vieja se descarta", () => {
    const p = make("visits");
    p.overlay(true, 0);
    p.react(1_000); // llega con la capa puesta: pendiente
    expect(p.visible).toBe(false);
    p.overlay(false, 5_000); // fresco: responde al liberarse
    expect(p.visible).toBe(true);
    p.tick(15_000); // se cerró
    // Ahora un momento que envejece bajo la capa: pasado el tope ya
    // no tiene sentido reaccionar a algo de hace rato.
    p.overlay(true, 16_000);
    p.react(106_000); // pasó el enfriamiento: queda pendiente
    expect(p.visible).toBe(false);
    p.tick(140_000);
    p.overlay(false, 140_000); // 34 s después: el momento pasó
    expect(p.visible).toBe(false);
  });

  it("en «always» el saludo solo prende la pose un momento", () => {
    const p = make("always");
    expect(p.visible).toBe(true); // ya está presente
    expect(p.greeting).toBe(false);
    p.greet(1_000);
    expect(p.greeting).toBe(true);
    p.tick(11_000);
    expect(p.greeting).toBe(false);
    expect(p.visible).toBe(true); // la presencia no se fue
  });

  it("sin lectura lista no hay presencia", () => {
    const p = createPresence({ mode: "always" });
    p.idle(false, 0);
    expect(p.visible).toBe(false);
    p.ready(true, 1_000);
    expect(p.visible).toBe(true);
  });
});
