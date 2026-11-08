// Hook extraído de Reader.tsx (R1b): estado de "chrome" del lector
// (barras, scroll, zen, stall, pacer) y los refs asociados. La lógica
// de efectos (zen fade, stall detector, pacer) sigue en Reader.tsx y
// opera sobre los setters/refs expuestos.
import { useRef, useState } from "react";
import type { DenseStallDetector } from "../lib/focus-telemetry";
import { newDenseStallDetector } from "../lib/focus-telemetry";
import { DEFAULT_WPM } from "../lib/progress";

export type UseReaderChromeResult = {
  barsVisible: boolean;
  setBarsVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  scrollRatio: number;
  setScrollRatio: (v: number) => void;
  wpm: number;
  setWpm: (v: number | ((prev: number) => number)) => void;
  strategyPaused: boolean;
  setStrategyPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  pacerPaused: boolean;
  setPacerPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  isZenFaded: boolean;
  setIsZenFaded: (v: boolean | ((prev: boolean) => boolean)) => void;
  stallBubble: string | null;
  setStallBubble: (v: string | null | ((prev: string | null) => string | null)) => void;
  toastMessage: string;
  setToastMessage: (v: string) => void;
  zenFadeTimerRef: { current: ReturnType<typeof setTimeout> | null };
  denseStallDetectorRef: { current: DenseStallDetector };
  stallBubbleTimerRef: { current: ReturnType<typeof setTimeout> | null };
  lastActivityAtRef: { current: number };
  lastPointerCheckRef: { current: number };
};

export function useReaderChrome(): UseReaderChromeResult {
  const [barsVisible, setBarsVisible] = useState(true);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [strategyPaused, setStrategyPaused] = useState(false);
  const [pacerPaused, setPacerPaused] = useState(false);
  const [isZenFaded, setIsZenFaded] = useState(false);
  const [stallBubble, setStallBubble] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  const zenFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const denseStallDetectorRef = useRef<DenseStallDetector>(newDenseStallDetector(0));
  const stallBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAtRef = useRef<number>(0);
  const lastPointerCheckRef = useRef<number>(0);

  return {
    barsVisible,
    setBarsVisible,
    scrollRatio,
    setScrollRatio,
    wpm,
    setWpm,
    strategyPaused,
    setStrategyPaused,
    pacerPaused,
    setPacerPaused,
    isZenFaded,
    setIsZenFaded,
    stallBubble,
    setStallBubble,
    toastMessage,
    setToastMessage,
    zenFadeTimerRef,
    denseStallDetectorRef,
    stallBubbleTimerRef,
    lastActivityAtRef,
    lastPointerCheckRef,
  };
}