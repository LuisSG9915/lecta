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
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import {
  getCompanionContextualGreeting,
  incrementCompanionBondLevel,
  type CareKind,
} from "../lib/companion-interactions";
import { ITEM_ACHIEVEMENT_REWARDS, type CatMood } from "../../shared/gamification";
import type { CompanionState } from "../lib/companion-state";
import type { CompanionArticle } from "../../shared/companion-data";
import Icon from "./Icon";

interface PetParticle {
  id: number;
  x: number;
  y: number;
  symbol: string;
  delay: number;
}

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
  bookTitle?: string | null;
}

export function CompanionStage({
  name,
  stage,
  mood,
  accessories = [],
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
  bookTitle,
}: CompanionStageProps) {
  // Posición normalizada en la pista [0, 1]. Solo estado local en memoria.
  const [catX, setCatX] = useState(0.5);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [lifted, setLifted] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [isWandering, setIsWandering] = useState(false);
  const [wanderDuration, setWanderDuration] = useState(1200);
  const [isSettling, setIsSettling] = useState(false);
  const [tapGreeting, setTapGreeting] = useState<string | null>(null);
  const [hopPose, setHopPose] = useState(false);
  const [particles, setParticles] = useState<PetParticle[]>([]);

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
      // Acariciar: frotar continuo durante >= 600ms o classifyGesture === "rub"
      if (gesture === "rub" || (elapsedMs >= 600 && movedPx >= 15)) {
        if (liftTimerRef.current) clearTimeout(liftTimerRef.current);
        if (!track.hasRubbed) {
          track.hasRubbed = true;
          triggerPurrHaptic();
          playCompanionSound("purr");
          spawnParticles();
          incrementCompanionBondLevel(1);
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

  const spawnParticles = useCallback(() => {
    const count = 3 + Math.floor(Math.random() * 3); // 3 a 5 partículas
    const newParticles: PetParticle[] = [];
    for (let i = 0; i < count; i++) {
      newParticles.push({
        id: Date.now() + i,
        x: 35 + Math.random() * 30,
        y: 15 + Math.random() * 35,
        symbol: Math.random() > 0.35 ? "♥" : "✦",
        delay: i * 120,
      });
    }
    setParticles((prev) => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.includes(p)));
    }, 1800);
  }, []);

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

    // Toque corto sin arrastre ni frote previo = Toque simple
    if (!wasRubbed && activeCare === null) {
      playCompanionSound("meow");
      triggerHaptic(15);
      const greeting = getCompanionContextualGreeting(name, streakDays, bookTitle);
      setTapGreeting(greeting);
      setTimeout(() => setTapGreeting(null), 4000);
      onCare("pet");
    }
  };

  const handleDoubleClick = () => {
    markInteraction();
    triggerHaptic(20);
    setHopPose(true);
    setTimeout(() => setHopPose(false), 700);
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

  // Mensaje en el globo: prioridad 1 prueba de ropa, 2 estado de cuidado, 3 saludo por toque o llegada
  let bubbleContent: { text: string; hasAction?: boolean } | null = null;
  if (tryOnArticle) {
    const ach = ITEM_ACHIEVEMENT_REWARDS[tryOnArticle];
    const hint = ach
      ? `Se desbloquea con el logro: ${ach.title}`
      : tryOnLevel !== null
        ? `Se desbloquea en el nivel ${tryOnLevel}`
        : "Prenda de prueba";
    bubbleContent = {
      text: `Así se vería · ${hint}`,
      hasAction: true,
    };
  } else if (careStatusText) {
    bubbleContent = { text: careStatusText };
  } else if (tapGreeting) {
    bubbleContent = { text: tapGreeting };
  } else if (greetingText) {
    bubbleContent = { text: greetingText };
  }

  // Determinación de la pose efectiva
  const effectivePose: CompanionPose | undefined =
    hopPose
      ? "playful_hop"
      : externalPose ??
        (isWandering ? "walk" : activeCare ? undefined : "idle");

  const hasRainyWindow =
    accessories.includes("stage_rainy_window") ||
    tryOnArticle === "stage_rainy_window";
  const hasAncientLibrary =
    accessories.includes("stage_ancient_library") ||
    tryOnArticle === "stage_ancient_library";

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
        {/* Fondos de Escenario */}
        {hasRainyWindow ? (
          <div className="companion-stage-backdrop companion-stage-backdrop--rain" aria-hidden="true">
            <svg className="companion-stage-backdrop-svg" viewBox="0 0 320 80" preserveAspectRatio="none">
              <rect x="0" y="0" width="320" height="80" fill="currentColor" opacity="0.04" />
              <line x1="80" y1="0" x2="80" y2="80" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
              <line x1="240" y1="0" x2="240" y2="80" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
              <line x1="0" y1="35" x2="320" y2="35" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
              <path
                d="M40 10 L35 22 M120 18 L115 30 M200 8 L195 20 M280 25 L275 37 M90 48 L85 60 M170 52 L165 64 M250 45 L245 57 M300 12 L295 24 M30 50 L25 62"
                stroke="var(--cat-rain, #7da5c2)"
                strokeWidth="1.2"
                strokeLinecap="round"
                opacity="0.5"
              />
            </svg>
          </div>
        ) : null}
        {hasAncientLibrary ? (
          <div className="companion-stage-backdrop companion-stage-backdrop--library" aria-hidden="true">
            <svg className="companion-stage-backdrop-svg" viewBox="0 0 320 80" preserveAspectRatio="none">
              <rect x="0" y="0" width="320" height="80" fill="currentColor" opacity="0.04" />
              <line x1="0" y1="58" x2="320" y2="58" stroke="var(--cat-wood, #8d5b3a)" strokeWidth="3" opacity="0.25" />
              <rect x="25" y="24" width="10" height="34" rx="1" fill="#7a3e3e" opacity="0.35" />
              <rect x="37" y="18" width="12" height="40" rx="1" fill="#3a5a7a" opacity="0.35" />
              <rect x="51" y="26" width="9" height="32" rx="1" fill="#8a6e3a" opacity="0.35" />
              <rect x="62" y="21" width="14" height="37" rx="1" fill="#4a6a4a" opacity="0.35" />
              <rect x="235" y="20" width="11" height="38" rx="1" fill="#8a5a3a" opacity="0.35" />
              <rect x="248" y="25" width="10" height="33" rx="1" fill="#5a3a6a" opacity="0.35" />
              <rect x="260" y="17" width="13" height="41" rx="1" fill="#7a4a3a" opacity="0.35" />
              <line x1="292" y1="48" x2="292" y2="58" stroke="#d97706" strokeWidth="2.5" />
              <ellipse cx="292" cy="45" rx="1.5" ry="3" fill="#f59e0b" opacity="0.8" />
            </svg>
          </div>
        ) : null}

        {/* Partículas flotantes de cariño / afinidad */}
        {particles.map((p) => (
          <span
            key={p.id}
            className="companion-stage-particle"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              animationDelay: `${p.delay}ms`,
            }}
            aria-hidden="true"
          >
            {p.symbol}
          </span>
        ))}

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
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Compañero ${name}. Arrástralo o usa las flechas para moverlo; presiona para acariciar.`}
          >
            {tryOnArticle ? (
              <span className="companion-tryon-badge" aria-label="Prenda en prueba">
                <Icon name="lock" size={11} />
              </span>
            ) : null}
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
