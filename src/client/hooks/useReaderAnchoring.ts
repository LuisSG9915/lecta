// Posesión de los refs de anclaje (pageAnchorRef, pendingPageRef).
// Primer paso de R1: centralizar la propiedad de los refs sin mover aún
// la lógica de restore (que vive en useReaderSectionLoader, useReaderReflow,
// useReaderSyntacticLines, useReaderPageMetrics). Extraído de Reader.tsx.
import { useRef } from "react";

type PendingPage = {
  snippet?: string;
  fragment?: string;
  anchor?: string;
  at?: "end";
  ratio?: number;
  flash?: boolean;
} | null;

export interface ReaderAnchoringRefs {
  pageAnchorRef: { current: string | null };
  pendingPageRef: { current: PendingPage };
}

export function useReaderAnchoring(): ReaderAnchoringRefs {
  const pageAnchorRef = useRef<string | null>(null);
  const pendingPageRef = useRef<PendingPage>(null);
  return { pageAnchorRef, pendingPageRef };
}