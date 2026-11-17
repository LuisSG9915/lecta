// Sincronización de posición remota (resumeRequest + positionSyncVersion) sobre
// el libro ya montado. Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";
import { loadBookPosition } from "../lib/idb";
import type { SavedBookPosition, DbScope } from "../lib/idb";
import type { ReaderNavigate } from "./useReaderNavigation";

type CaptureDbScope = () => DbScope;
type CapturePosition = () => SavedBookPosition | null;

type Deps = {
  resumeRequest: {
    key: number;
    sectionIndex: number;
    ratio?: number;
    anchor?: string;
    anchorOffset?: number;
    resumeAudio?: boolean;
  } | null;
  positionSyncVersion: number | undefined;
  state: string;
  bookHash: string;
  navigate: ReaderNavigate;
  capturePosition: CapturePosition;
  captureDbScope: CaptureDbScope;
  onStatus: (msg: string) => void;
  sectionIndexRef: { current: number };
};

export function useReaderPositionSync(deps: Deps): void {
  const {
    resumeRequest,
    positionSyncVersion,
    state,
    bookHash,
    navigate,
    capturePosition,
    captureDbScope,
    onStatus,
    sectionIndexRef,
  } = deps;

  const appliedSyncVersionRef = useRef<number | undefined>(0);
  const appliedResumeKeyRef = useRef(0);

  useEffect(() => {
    if (!resumeRequest || resumeRequest.key === appliedResumeKeyRef.current) return;
    if (state !== "ready") return;
    appliedResumeKeyRef.current = resumeRequest.key;
    void navigate("resume", {
      index: resumeRequest.sectionIndex,
      restore: {
        ratio: resumeRequest.ratio,
        anchor: resumeRequest.anchor,
        anchorOffset: resumeRequest.anchorOffset,
      },
    });
    onStatus(
      resumeRequest.resumeAudio
        ? "Retomando donde dejaste de escuchar…"
        : "Continuando desde tu otro dispositivo…",
    );
  }, [resumeRequest, state, navigate, onStatus]);

  useEffect(() => {
    if (
      positionSyncVersion !== undefined &&
      appliedSyncVersionRef.current !== undefined &&
      positionSyncVersion <= appliedSyncVersionRef.current
    )
      return;
    if (state !== "ready") return;
    appliedSyncVersionRef.current = positionSyncVersion;
    let cancelled = false;
    void (async () => {
      const current = capturePosition();
      const atStart =
        sectionIndexRef.current === 0 && (!current || (current.ratio ?? 0) < 0.02);
      if (!atStart) return;
      const saved = await loadBookPosition(bookHash, captureDbScope());
      if (cancelled || !saved) return;
      if (saved.sectionIndex === 0 && (saved.ratio ?? 0) < 0.02) return;
      await navigate("resume", {
        index: saved.sectionIndex,
        restore: {
          ratio: saved.ratio,
          anchor: saved.anchor,
          anchorOffset: saved.anchorOffset,
        },
      });
      onStatus("Retomando donde lo dejaste en otro dispositivo.");
    })().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [positionSyncVersion, state, capturePosition, bookHash, navigate, onStatus, captureDbScope, sectionIndexRef]);
}