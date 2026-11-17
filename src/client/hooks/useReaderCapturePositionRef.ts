// Espejo de capturePosition en un ref estable (identidad estable para la
// limpieza de desmontaje de useReaderPersistence). Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import type { SavedBookPosition } from "../lib/idb";

type Ref<T> = { current: T };

type Deps = {
  capturePosition: () => SavedBookPosition | null;
  capturePositionRef: Ref<() => SavedBookPosition | null>;
};

export function useReaderCapturePositionRef(deps: Deps): void {
  const { capturePosition, capturePositionRef } = deps;

  useEffect(() => {
    capturePositionRef.current = capturePosition;
  }, [capturePosition, capturePositionRef]);
}