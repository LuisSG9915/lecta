// Ajustes del lector: aplica un parche sobre los ajustes vigentes, resuelve el
// modo de enfoque resultante y lo persiste en el libro.
//
// Extraído de Reader.tsx (línea de trabajo posterior a la Fase 7). La acción es
// estable: se apoya en el updater funcional de setSettings, así que no captura
// ajustes viejos y no rearma a los componentes que la reciben por prop.
import { useCallback, useEffect, useRef } from "react";
import { deriveFocusMode, saveReaderSettings, type ReaderSettings } from "../lib/settings";

export interface UseReaderSettingsOptions {
  bookHash: string;
  setSettings: (updater: (current: ReaderSettings) => ReaderSettings) => void;
  setBookOverride: (override: boolean) => void;
  /** Se llama síncrono, con el layout viejo aún en pantalla, antes de un parche que refluye el texto. */
  beforeReflow?: () => void;
}

const REFLOW_KEYS = ["size", "fontSize", "font", "measure", "leading", "layout", "pageColumns", "textSpacing"] as const;
const REFLOW_CAPTURE_GAP_MS = 150;

export function useReaderSettings(options: UseReaderSettingsOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const lastReflowCaptureRef = useRef(0);

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    const { bookHash, setSettings, setBookOverride, beforeReflow } = optionsRef.current;
    // Ancla fresca: la última posición guardada puede ser de hace segundos y
    // el reflujo la restauraría atrás. Con clics seguidos se conserva la
    // primera captura (la restauración del anterior aún no corrió).
    const now = Date.now();
    if (
      beforeReflow &&
      REFLOW_KEYS.some((k) => (patch as Record<string, unknown>)[k] !== undefined) &&
      now - lastReflowCaptureRef.current > REFLOW_CAPTURE_GAP_MS
    ) {
      beforeReflow();
      lastReflowCaptureRef.current = now;
    }
    setSettings((current) => {
      let presetPatch: Partial<ReaderSettings> = {};
      if (
        (patch.focusRuler !== undefined ||
          patch.paragraphFocus !== undefined ||
          patch.syntacticLines !== undefined ||
          patch.chromaticGuide !== undefined ||
          patch.bionicAnchors !== undefined ||
          patch.visualPacer !== undefined ||
          patch.colorGuide !== undefined) &&
        (patch.strategyPreset === undefined || patch.readingPreset === undefined)
      ) {
        presetPatch = {
          strategyPreset: patch.strategyPreset ?? "custom",
          readingPreset: "custom",
        };
      }
      const next = { ...current, ...patch, ...presetPatch };
      if (patch.chromaticGuide === undefined && patch.colorGuide !== undefined) {
        next.chromaticGuide = Boolean(patch.colorGuide);
      } else if (patch.chromaticGuide !== undefined) {
        next.colorGuide = next.chromaticGuide;
      }
      if (patch.bionicAnchors === undefined && patch.bionicReading !== undefined) {
        next.bionicAnchors = Boolean(patch.bionicReading);
      } else if (patch.bionicAnchors !== undefined) {
        next.bionicReading = next.bionicAnchors;
      }
      if (patch.focusRuler === true) {
        next.focusRuler = true;
        next.paragraphFocus = false;
      } else if (patch.paragraphFocus === true) {
        next.paragraphFocus = true;
        next.focusRuler = false;
      } else if (patch.focusRuler === false && patch.paragraphFocus === false) {
        next.focusRuler = false;
        next.paragraphFocus = false;
      }
      next.focusMode =
        patch.focusMode !== undefined ? patch.focusMode : deriveFocusMode(next);
      saveReaderSettings(next, bookHash);
      setBookOverride(true);
      return next;
    });
  }, []);

  return { updateSettings };
}
