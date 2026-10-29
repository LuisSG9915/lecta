// Pegamento React del planificador puro de presencia (fase 5). El
// lector le da señales — actividad elegible (deltas entre señales
// reales de noteActivity, ya acotados), pausas (hojas, paneles,
// consultas, hoja del gato), pestaña oculta, inactividad y el estado
// de la máquina local — y lee `visible` para decidir si el gato se
// dibuja. El modo llega de la preferencia «readingPresence» de la
// cuenta y se aplica sin desmontar el lector.
//
// `suppressed` («Ocultar por esta lectura») vive aquí como estado de
// sesión del libro: dura hasta cerrar el lector y nunca se persiste
// como preferencia de cuenta.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPresence, type PresenceController } from "./companion-presence";
import type { CompanionState } from "./companion-state";
import type { ReadingPresence } from "../../shared/companion-data";

// Tiempo elegible de una señal de lectura: lo que pasó desde la señal
// anterior del segmento, acotado por `capMs` (un hueco largo no regala
// su tiempo). Medirlo ANTES de que el llamador pise lastActiveAt —
// después del refresco siempre da 0 y el gato nunca aparecería.
export function eligibleDelta(
  seg: { lastActiveAt: number } | null | undefined,
  now: number,
  capMs: number,
): number {
  return seg ? Math.max(0, Math.min(now - seg.lastActiveAt, capMs)) : 0;
}

export interface ReaderPresence {
  // ¿Se dibuja el gato ahora mismo?
  visible: boolean;
  // La visita abierta es el saludo de bienvenida: el lector lo usa
  // para la pose (pata en alto) en vez del estado de la máquina.
  greeting: boolean;
  // Saludo breve al abrir el libro: una vez por lectura, no pide
  // acumulado elegible ni gasta el cooldown de visitas.
  greet: () => void;
  // El lector hizo algo que amerita respuesta (consulta, meta,
  // fatiga): el gato asoma un momento a reaccionar.
  react: () => void;
  // Supresión temporal del usuario, por libro.
  suppressed: boolean;
  setSuppressed: (on: boolean) => void;
  // Una señal real de lectura: delta elegible ya acotado por el
  // llamador (hueco > IDLE_MS no cuenta completo).
  activity: (deltaMs: number) => void;
  // El lector quedó sin segmento vivo (sweep de inactividad o pausa).
  idle: (on: boolean) => void;
}

export function useReaderPresence({
  enabled,
  mode,
  ready,
  overlay,
  hidden,
  machine,
}: {
  // Juego encendido en la cuenta: apagado se trata como «off».
  enabled: boolean;
  mode: ReadingPresence;
  // Lectura lista (state === "ready").
  ready: boolean;
  // Hoja/panel/consulta encima — también la hoja del gato.
  overlay: boolean;
  // document.hidden.
  hidden: boolean;
  // Estado de la máquina local; null cuando el juego está apagado.
  machine: CompanionState | null;
}): ReaderPresence {
  const [visible, setVisible] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const ref = useRef<PresenceController | null>(null);

  useEffect(() => {
    const ctl = createPresence({
      mode: "visits", // el modo real llega por el efecto de abajo
      onChange: (v, g) => {
        setVisible(v);
        setGreeting(g);
      },
    });
    ref.current = ctl;
    return () => {
      ref.current = null;
      setVisible(false);
      setGreeting(false);
    };
  }, []);

  useEffect(() => {
    ref.current?.mode(enabled ? mode : "off");
  }, [enabled, mode]);
  useEffect(() => {
    ref.current?.suppress(suppressed);
  }, [suppressed]);
  useEffect(() => {
    ref.current?.ready(ready);
  }, [ready]);
  useEffect(() => {
    ref.current?.overlay(overlay);
  }, [overlay]);
  useEffect(() => {
    ref.current?.hidden(hidden);
  }, [hidden]);
  useEffect(() => {
    if (machine) ref.current?.machine(machine);
  }, [machine]);

  // El fin de la visita lo marca el reloj de pared: un latido corto
  // basta para retirarla a tiempo. Con el juego apagado o la pestaña
  // oculta no hay latido que valga: el intervalo se detiene y al volver
  // se pone al día con una sola evaluación.
  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;
    let timer: number | undefined;
    const tick = () => ref.current?.tick(Date.now());
    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(tick, 1_000);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      tick();
      start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [enabled]);

  const activity = useCallback((deltaMs: number) => {
    const ctl = ref.current;
    if (!ctl) return;
    ctl.idle(false);
    ctl.active(deltaMs);
  }, []);
  const idle = useCallback((on: boolean) => {
    ref.current?.idle(on);
  }, []);
  const greet = useCallback(() => {
    ref.current?.greet(Date.now());
  }, []);
  const react = useCallback(() => {
    ref.current?.react(Date.now());
  }, []);

  return {
    visible,
    greeting,
    greet,
    react,
    suppressed,
    setSuppressed,
    activity,
    idle,
  };
}
