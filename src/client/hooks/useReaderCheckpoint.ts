// Micro-hitos de página (25%, 50%, 75%, 100%) para dopamina visual.
// Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";

type Deps = {
  viewRatio: number;
  sectionIndex: number;
  state: string;
  presenceReact: () => void;
};

export function useReaderCheckpoint(deps: Deps): void {
  const { viewRatio, sectionIndex, state, presenceReact } = deps;
  const lastCheckpointRef = useRef<number>(0);
  const lastSectionForCheckpointRef = useRef<number>(sectionIndex);

  useEffect(() => {
    if (lastSectionForCheckpointRef.current !== sectionIndex) {
      lastSectionForCheckpointRef.current = sectionIndex;
      lastCheckpointRef.current = 0;
    }
    if (state !== "ready") return;
    const checkpoints = [0.25, 0.5, 0.75, 1.0];
    for (const cp of checkpoints) {
      if (viewRatio >= cp && lastCheckpointRef.current < cp) {
        lastCheckpointRef.current = cp;
        window.dispatchEvent(
          new CustomEvent("lecta:checkpoint-reached", {
            detail: { checkpoint: cp },
          }),
        );
        presenceReact();
        break;
      }
    }
  }, [viewRatio, sectionIndex, state, presenceReact]);
}