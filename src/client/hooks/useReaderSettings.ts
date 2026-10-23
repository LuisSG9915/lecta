// Ajustes del lector: aplica un parche sobre los ajustes vigentes, resuelve el
// modo de enfoque resultante y lo persiste en el libro.
//
// Extraído de Reader.tsx (línea de trabajo posterior a la Fase 7). La acción es
// estable: se apoya en el updater funcional de setSettings, así que no captura
// ajustes viejos y no rearma a los componentes que la reciben por prop.
import { useCallback, useEffect, useRef } from "react";
import { saveReaderSettings, type ReaderSettings } from "../lib/settings";

export interface UseReaderSettingsOptions {
  bookHash: string;
  setSettings: (updater: (current: ReaderSettings) => ReaderSettings) => void;
  setBookOverride: (override: boolean) => void;
}

export function useReaderSettings(options: UseReaderSettingsOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    const { bookHash, setSettings, setBookOverride } = optionsRef.current;
    setSettings((current) => {
      let presetPatch: Partial<ReaderSettings> = {};
      if (
        (patch.focusRuler !== undefined ||
          patch.paragraphFocus !== undefined ||
          patch.syntacticLines !== undefined ||
          patch.chromaticGuide !== undefined ||
          (patch as Record<string, unknown>).colorGuide !== undefined) &&
        (patch.strategyPreset === undefined || patch.readingPreset === undefined)
      ) {
        presetPatch = {
          strategyPreset: patch.strategyPreset ?? "custom",
          readingPreset: "custom",
        };
      }
      const next = { ...current, ...patch, ...presetPatch };
      if (patch.focusRuler === true) {
        next.focusRuler = true;
        next.paragraphFocus = false;
        next.focusMode = "ruler";
      } else if (patch.paragraphFocus === true) {
        next.paragraphFocus = true;
        next.focusRuler = false;
        next.focusMode = "paragraph";
      } else if (patch.focusMode !== undefined) {
        next.focusMode = patch.focusMode;
      } else if (patch.focusRuler === false && patch.paragraphFocus === false) {
        next.focusRuler = false;
        next.paragraphFocus = false;
        if (next.chromaticGuide) {
          next.focusMode = "chromatic";
        } else if (next.syntacticLines) {
          next.focusMode = "syntactic";
        } else {
          next.focusMode = "off";
        }
      } else if (next.paragraphFocus) {
        next.focusMode = "paragraph";
      } else if (next.focusRuler) {
        next.focusMode = "ruler";
      } else if (next.chromaticGuide) {
        next.focusMode = "chromatic";
      } else if (next.syntacticLines) {
        next.focusMode = "syntactic";
      } else {
        next.focusMode = "off";
      }
      saveReaderSettings(next, bookHash);
      setBookOverride(true);
      return next;
    });
  }, []);

  return { updateSettings };
}
