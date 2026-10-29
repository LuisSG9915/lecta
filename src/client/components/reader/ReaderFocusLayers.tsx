// Capas de superposición del lector: la regla de enfoque (con la pata del gato
// anclada al margen) y el indicador de retiro de lectura profunda.
//
// Extraídas de Reader.tsx (Fase 7). Solo pintan.
import { Companion } from "../Companion";
import { FocusRuler, rulerBandPx } from "../FocusRuler";
import type { CompanionContextValue } from "../CompanionProvider";
import type { CompanionState } from "../../lib/companion-state";
import type { DeepReadingState } from "../../lib/deep-reading";
import { formatElapsedMinutes, formatRemainingTime } from "../../lib/deep-reading";
import type { ReaderSettings } from "../../lib/settings";
import type { RefObject } from "react";

export interface ReaderFocusLayersProps {
  settings: ReaderSettings;
  state: "idle" | "opening" | "ready" | "error";
  strategyPaused: boolean;
  catEnabled: boolean;
  presenceMode: string;
  catSuppressed: boolean;
  companion: CompanionContextValue;
  catState: CompanionState | null;
  isDeepReading: boolean;
  deepReading: DeepReadingState | null;
  finishDeepReading: (completed: boolean) => void | Promise<unknown>;
  progress: number;
  /**
   * Nodo del contador de retiro: el lector escribe ahí los segundos sin
   * re-renderizar 4 500 líneas de JSX cada segundo.
   */
  deepIndicatorRef?: RefObject<HTMLSpanElement | null>;
}

export function ReaderFocusLayers(props: ReaderFocusLayersProps) {
  const {
  settings,
  state,
  strategyPaused,
  catEnabled,
  presenceMode,
  catSuppressed,
  companion,
  catState,
  isDeepReading,
  deepReading,
  finishDeepReading,
  progress,
  deepIndicatorRef,
  } = props;

  return (
    <>
  {/* Regla de enfoque: velo de papel con una franja clara que
      sigue al puntero; la patita del gato ancla el margen. Con
      presencia «off» o el gato suprimido por esta lectura la
      decoración también se va: no queda rastro del gato. */}
  {!strategyPaused && (settings.focusRuler || settings.focusMode === "ruler") && !settings.paragraphFocus && state === "ready" ? (
    <FocusRuler
      enabled={true}
      heightPx={rulerBandPx(
        settings.rulerSize,
        settings.size * settings.leading,
      )}
      bandPx={rulerBandPx(
        settings.rulerSize,
        settings.size * settings.leading,
      )}
      lineHeightPx={settings.size * settings.leading}
      anchor={
        catEnabled && presenceMode !== "off" && !catSuppressed ? (
          <Companion
            stage={companion.stage}
            mood="awake"
            accessories={companion.accessories}
            focus={catState ?? "reading"}
            decorative
          />
        ) : undefined
      }
    />
  ) : null}
  {isDeepReading && deepReading ? (
    <>
      <aside
        className="reader-deep-indicator"
        aria-label="Sesión de retiro de lectura"
      >
        <span className="reader-deep-indicator-text" ref={deepIndicatorRef}>
          {deepReading.targetEndedAt
            ? formatRemainingTime(
                Math.max(
                  0,
                  deepReading.targetMinutes * 60_000 - deepReading.elapsedMs,
                ),
              )
            : `${formatElapsedMinutes(deepReading.elapsedMs)} en retiro`}
        </span>
        <button
          type="button"
          className="reader-deep-indicator-btn"
          onClick={() => void finishDeepReading(false)}
          aria-label="Concluir retiro de lectura"
        >
          Concluir
        </button>
      </aside>
      <div
        className="reader-deep-thread"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progreso general en retiro"
      >
        <div
          className="reader-deep-thread-fill"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </>
  ) : null}


    </>
  );
}
