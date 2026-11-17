// Espejos de estado en refs estables (layoutRef, pageEnteredAtRef). Extraídos
// de Reader.tsx (B7). Efectos triviales agrupados por ser espejos de ref.
import { useEffect } from "react";

type Ref<T> = { current: T };

type Deps<S> = {
  layout: string;
  layoutRef: Ref<string>;
  page: number;
  sectionIndex: number;
  pageEnteredAtRef: Ref<number>;
  settings: S;
  settingsRef: Ref<S | null>;
};

export function useReaderRefMirrors<S>(deps: Deps<S>): void {
  const { layout, layoutRef, page, sectionIndex, pageEnteredAtRef, settings, settingsRef } = deps;

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout, layoutRef]);

  useEffect(() => {
    pageEnteredAtRef.current = Date.now();
  }, [page, sectionIndex, pageEnteredAtRef]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings, settingsRef]);
}