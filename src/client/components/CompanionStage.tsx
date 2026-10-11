// Rincón del compañero: escenario con gato protagonista que se arrastra,
// pasea solo cuando está ocioso y muestra su estado/saludos en un globo
// flotante sobre una línea de suelo sutil.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Companion, type CompanionPose } from "./Companion";
import {
  canWander,
  clampX,
  classifyGesture,
  nextWanderTarget,
  walkDuration,
  xFromPointer,
} from "../lib/companion-stage";
import { triggerPurrHaptic } from "../lib/haptics";
import type { CareKind } from "../lib/companion-interactions";
import type { CatMood } from "../lib/gamification";
import type { CompanionState } from "../lib/companion-state";
import type { CompanionArticle } from "../../shared/companion-data";

export interface CompanionStageProps {
  name: string;
  stage: number;
  mood: CatMood;
  accessories: string[];
  focus?: CompanionState | null;
  pose?: CompanionPose;
  activeCare: CareKind | null;
  onCare: (kind: CareKind) => void;
  reducedMotion: boolean;
  streakDays: number;
  hasReadToday: boolean;
  greetingText: string | null;
  careStatusText: string | null;
  tryOnArticle: CompanionArticle | null;
  tryOnLevel: number | null;
  onClearTryOn: () => void;
  inCloset?: boolean;
}

export function CompanionStage({
  name,
  stage,
  mood,
  accessories,
  focus,
  pose: externalPose,
  activeCare,
  onCare,
  reducedMotion,
  streakDays,
  hasReadToday,
  greetingText,
  careStatusText,
  tryOnArticle,
  tryOnLevel,
  onClearTryOn,
  inCloset = false,
}: CompanionStageProps) {
  // Posición normalizada en la pista [0, 1]. Solo estado local en memoria.
  const [catX, setCatX] = useState(0.5);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [lifted, setLifted] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [isWandering, setIsWandering] = useState(false);
  const [wanderDuration, setWanderDuration] = useState(1200);
  const [isSettling, setIsSettling] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const catBtnRef = useRef<HTMLButtonElement>(null);
  const lastInteractionRef = useRef(0);
  const liftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wanderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  // Registro del puntero para diferenciar caricia rápida vs arrastre
  const pointerTrackRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastTime: number;
    hasRubbed: boolean;
    hasLifted: boolean;
  } | null>(null);

  // --- Paseo autónomo cada 7–13s ---
  const markInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    let mounted = true;
    const scheduleNextWander = () => {
      const delay = 7000 + Math.random() * 6000;
      wanderTimerRef.current = setTimeout(() => {
        if (!mounted) return;
        const idleMs = Date.now() - lastInteractionRef.current;
        const hidden = document.visibilityState === "hidden";
        const ready = canWander({
          mood,
          activeCare,
          reducedMotion,
          dragging: lifted || pointerTrackRef.current?.hasLifted === true,
          hidden,
          idleMs,
          inCloset,
          tryOn: Boolean(tryOnArticle),
        });

        if (ready && trackRef.current) {
          const target = nextWanderTarget(Math.random(), catX);
          const dx = target - catX;
          const dur = walkDuration(dx);
          setFacing(dx >= 0 ? 1 : -1);
          setWanderDuration(dur);
          setIsWandering(true);
          setCatX(target);

          setTimeout(() => {
            if (mounted) setIsWandering(false);
          }, dur);
        }

        scheduleNextWander();
      }, delay);
    };

    scheduleNextWander();
    return () => {
      mounted = false;
      if (wanderTimerRef.current) clearTimeout(wanderTimerRef.current);
    };
  }, [
    catX,
    mood,
    activeCare,
    reducedMotion,
    lifted,
    inCloset,
    tryOnArticle,
  ]);

  // --- Gestos de puntero: toque/frotar vs levantar y arrastrar ---
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    markInteraction();
    setIsWandering(false);

    if (liftTimerRef.current) clearTimeout(liftTimerRef.current);

    const track = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      hasRubbed: false,
      hasLifted: false,
    };
    pointerTrackRef.current = track;

    // Temporizador de 220ms para entrar en estado de levitación
    liftTimerRef.current = setTimeout(() => {
      if (pointerTrackRef.current?.id === event.pointerId && !track.hasRubbed) {
        track.hasLifted = true;
        setLifted(true);
        triggerPurrHaptic();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
    }, 220);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const track = pointerTrackRef.current;
    if (!track || track.id !== event.pointerId) return;
    markInteraction();

    const elapsedMs = event.timeStamp - track.startTime;
    const movedPx = Math.hypot(
      event.clientX - track.startX,
      event.clientY - track.startY,
    );

    if (!track.hasLifted) {
      const gesture = classifyGesture({ elapsedMs, movedPx });
      if (gesture === "rub") {
        if (liftTimerRef.current) clearTimeout(liftTimerRef.current);
        if (!track.hasRubbed) {
          track.hasRubbed = true;
          onCare("pet");
        }
      }
      return;
    }

    // Ya está levantado: arrastrar horizontalmente
    const dt = event.timeStamp - track.lastTime;
    const dx = event.clientX - track.lastX;
    if (dt > 0) {
      const vel = dx / dt;
      // Inclinación máxima de ±4° según la velocidad de arrastre
      setTilt(Math.max(-4, Math.min(4, vel * 6)));
    }
    track.lastX = event.clientX;
    track.lastTime = event.timeStamp;

    if (trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      const newX = xFromPointer(event.clientX, rect);
      if (newX > catX) setFacing(1);
      else if (newX < catX) setFacing(-1);
      setCatX(newX);
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const track = pointerTrackRef.current;
    if (!track || track.id !== event.pointerId) return;
    if (liftTimerRef.current) clearTimeout(liftTimerRef.current);

    const wasLifted = track.hasLifted;
    const wasRubbed = track.hasRubbed;
    pointerTrackRef.current = null;

    if (wasLifted) {
      setLifted(false);
      setTilt(0);
      setIsSettling(true);
      setTimeout(() => setIsSettling(false), 220);
      return;
    }

    // Toque corto sin arrastre ni frote previo = Acariciar
    if (!wasRubbed && activeCare === null) {
      onCare("pet");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    markInteraction();
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setFacing(-1);
      setCatX((x) => clampX(x - 0.1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setFacing(1);
      setCatX((x) => clampX(x + 0.1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeCare === null) onCare("pet");
    }
  };

  // Mensaje en el globo: prioridad 1 prueba de ropa, 2 estado de cuidado, 3 saludo
  let bubbleContent: { text: string; hasAction?: boolean } | null = null;
  if (tryOnArticle) {
    bubbleContent = {
      text: `Así se vería. Se desbloquea en el nivel ${tryOnLevel ?? ""}`.trim(),
      hasAction: true,
    };
  } else if (careStatusText) {
    bubbleContent = { text: careStatusText };
  } else if (greetingText) {
    bubbleContent = { text: greetingText };
  }

  // Determinación de la pose efectiva
  const effectivePose: CompanionPose | undefined =
    externalPose ??
    (isWandering ? "walk" : activeCare ? undefined : "idle");

  return (
    <div className="companion-stage">
      {/* Globo de diálogo absoluto (no suma altura fija) */}
      {bubbleContent ? (
        <div className="companion-bubble" role="status">
          <span className="companion-bubble-text">{bubbleContent.text}</span>
          {bubbleContent.hasAction ? (
            <button
              type="button"
              className="btn--quiet companion-bubble-action"
              onClick={onClearTryOn}
            >
              Quitar prueba
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Pista horizontal donde se mueve el gato */}
      <div ref={trackRef} className="companion-stage-track">
        <div
          className="companion-stage-actor"
          style={{
            transform: `translateX(calc(${catX} * (100% - var(--cat-size))))`,
            transition: isWandering
              ? `transform ${wanderDuration}ms var(--ease-settle)`
              : isSettling
                ? `transform var(--dur-4) var(--ease-settle)`
                : "none",
          }}
        >
          <button
            ref={catBtnRef}
            type="button"
            className="companion-stage-cat"
            data-lifted={lifted || undefined}
            style={{
              transform: `scaleX(${facing}) rotate(${tilt}deg) scale(${lifted ? 1.04 : 1})`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Compañero ${name}. Arrástralo o usa las flechas para moverlo; presiona para acariciar.`}
          >
            <Companion
              stage={stage}
              mood={mood}
              accessories={accessories}
              focus={focus}
              pose={effectivePose}
              name={name}
              decorative
            />
            {activeCare === "pet" ? (
              <span className="companion-pet-hearts" aria-hidden="true">
                ♥
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Suelo: regla fina con tazón o estado de lectura */}
      <div className="companion-stage-floor">
        <div className="companion-stage-line" aria-hidden="true" />
        <div className="companion-stage-status">
          {hasReadToday ? (
            <p className="companion-goal-badge" role="status">
              <span className="companion-goal-icon" aria-hidden="true">
                🥣
              </span>
              Plato lleno hoy · Racha de {streakDays}{" "}
              {streakDays === 1 ? "día" : "días"}
              {streakDays >= 3 ? (
                <span
                  className="companion-shield-hint"
                  title="Marcapáginas protector activo: si un día no lees, tu gato cuidará tu racha"
                >
                  {" "}· 🔖 Activo
                </span>
              ) : null}
            </p>
          ) : (
            <p className="companion-goal-badge companion-goal-badge--pending">
              <span className="companion-goal-icon" aria-hidden="true">
                📖
              </span>
              Lectura pendiente hoy
              {streakDays >= 3 ? (
                <span
                  className="companion-shield-hint"
                  title="Marcapáginas protector activo: si un día no lees, tu gato cuidará tu racha"
                >
                  {" "}· 🔖 Activo
                </span>
              ) : null}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
