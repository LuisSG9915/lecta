import { useEffect, useRef, useState } from "react";

export interface ProgressInkProps {
  value: number;
  max: number;
  floor?: number;
  level?: number;
  label?: string;
  ariaValueText?: string;
  reducedMotion?: boolean;
  variant?: "vermilion" | "ink" | "ochre";
  className?: string;
  style?: React.CSSProperties;
}

export function ProgressInk({
  value,
  max,
  floor = 0,
  level,
  label,
  ariaValueText,
  reducedMotion = false,
  variant = "vermilion",
  className = "",
  style,
}: ProgressInkProps) {
  const targetRatio =
    max > floor ? Math.min(1, Math.max(0, (value - floor) / (max - floor))) : 0;

  // Seguimiento de escala para animar sin reiniciar desde 0 en cada render.
  const [scale, setScale] = useState(() => targetRatio);
  const [transitioning, setTransitioning] = useState(false);
  const prevLevel = useRef<number | undefined>(level);
  const prevRatio = useRef(targetRatio);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayScale = reducedMotion ? targetRatio : scale;

  useEffect(() => {
    // Si se pide movimiento reducido, solo actualiza referencias sin animar ni causar renders adicionales.
    if (reducedMotion) {
      prevLevel.current = level;
      prevRatio.current = targetRatio;
      return;
    }

    const wasLevelUp =
      level !== undefined &&
      prevLevel.current !== undefined &&
      level > prevLevel.current;

    prevLevel.current = level;

    if (wasLevelUp) {
      // Secuencia de subida de nivel:
      // 1. Llena hasta 100% (350 ms)
      // 2. Pausa breve (100 ms)
      // 3. Vuelve instantáneamente a 0%
      // 4. Llena hasta el nuevo valor (400 ms)
      setTransitioning(true);
      setScale(1);

      timerRef.current = setTimeout(() => {
        // Salto a 0 sin transición
        setTransitioning(false);
        setScale(0);

        timerRef.current = setTimeout(() => {
          // Llenado al nuevo ratio con transición
          setTransitioning(true);
          setScale(targetRatio);
          prevRatio.current = targetRatio;
        }, 80);
      }, 400);

      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    // Actualización regular: anima suavemente desde el valor previo al nuevo
    setTransitioning(true);
    setScale(targetRatio);
    prevRatio.current = targetRatio;
  }, [targetRatio, level, reducedMotion]);

  const fillStyle: React.CSSProperties = {
    transform: `scaleX(${displayScale})`,
    transformOrigin: "left center",
    transition:
      transitioning && !reducedMotion
        ? "transform var(--dur-5, 320ms) var(--ease-settle)"
        : "none",
  };

  const formattedAriaText =
    ariaValueText ??
    `${Math.round(value)} de ${max}${level !== undefined ? ` para el nivel ${level + 1}` : ""}`;

  return (
    <div
      className={`progress-ink progress-ink--${variant} ${className}`.trim()}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={floor}
      aria-valuemax={max}
      aria-valuetext={formattedAriaText}
      style={style}
    >
      <div className="progress-ink-fill" style={fillStyle} />
    </div>
  );
}
