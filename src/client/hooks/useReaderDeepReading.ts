// Hook extraído de Reader.tsx (R1c): estado del modo Retiro de lectura
// (deep reading) y sus derivados. La lógica de ciclo (finish/start/
// temporizador) sigue en Reader.tsx y opera sobre los setters expuestos.
import { useEffect, useRef, useState } from "react";
import type { DeepReadingState, DeepReadingSummary } from "../lib/deep-reading";
import type { PageRecapResult } from "../lib/page-recap";

export type ReturnPosition = {
  sectionIndex: number;
  anchor?: string;
  anchorOffset?: number;
  ratio: number;
  scrollTop?: number;
  page?: number;
};

export type UseReaderDeepReadingResult = {
  deepModal: boolean;
  setDeepModal: (v: boolean) => void;
  pageRecap: { loading: boolean; data: PageRecapResult | null; error: string | null } | null;
  setPageRecap: (v: { loading: boolean; data: PageRecapResult | null; error: string | null } | null) => void;
  deepReading: DeepReadingState | null;
  setDeepReading: (v: DeepReadingState | null | ((prev: DeepReadingState | null) => DeepReadingState | null)) => void;
  deepSummary: DeepReadingSummary | null;
  setDeepSummary: (v: DeepReadingSummary | null) => void;
  returnPositions: ReturnPosition[];
  setReturnPositions: (v: ReturnPosition[] | ((prev: ReturnPosition[]) => ReturnPosition[])) => void;
  deepReadingRef: { current: DeepReadingState | null };
  isDeepReading: boolean;
};

export function useReaderDeepReading(): UseReaderDeepReadingResult {
  const [deepModal, setDeepModal] = useState(false);
  const [pageRecap, setPageRecap] = useState<{
    loading: boolean;
    data: PageRecapResult | null;
    error: string | null;
  } | null>(null);
  const [deepReading, setDeepReading] = useState<DeepReadingState | null>(null);
  const [deepSummary, setDeepSummary] = useState<DeepReadingSummary | null>(null);
  const [returnPositions, setReturnPositions] = useState<ReturnPosition[]>([]);

  const deepReadingRef = useRef<DeepReadingState | null>(null);
  useEffect(() => {
    deepReadingRef.current = deepReading;
  }, [deepReading]);

  return {
    deepModal,
    setDeepModal,
    pageRecap,
    setPageRecap,
    deepReading,
    setDeepReading,
    deepSummary,
    setDeepSummary,
    returnPositions,
    setReturnPositions,
    deepReadingRef,
    isDeepReading: Boolean(deepReading?.active),
  };
}