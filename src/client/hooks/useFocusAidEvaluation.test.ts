// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_AID_EVAL_MS, useFocusAidEvaluation } from "./useFocusAidEvaluation";
import {
  DEFAULT_FOCUS_TELEMETRY_PROFILE,
  loadFocusTelemetryProfile,
  saveFocusTelemetryProfile,
} from "../lib/focus-telemetry";
import { READER_DEFAULTS, type ReaderSettings } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useFocusAidEvaluation", () => {
  let host: HTMLDivElement;
  let root: Root;
  let api!: ReturnType<typeof useFocusAidEvaluation>;

  function Probe(props: {
    settings: ReaderSettings;
    settingsRef: { current: ReaderSettings | null };
  }) {
    api = useFocusAidEvaluation(props);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    saveFocusTelemetryProfile({ ...DEFAULT_FOCUS_TELEMETRY_PROFILE });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("premia la ayuda si sigue activa tras 90 s", () => {
    const activeSettings: ReaderSettings = { ...READER_DEFAULTS, paragraphFocus: true };
    const settingsRef = { current: activeSettings };

    act(() => {
      root.render(h(Probe, { settings: activeSettings, settingsRef }));
    });
    act(() => {
      api.scheduleFocusAidEvaluation("paragraph-focus");
    });

    expect(loadFocusTelemetryProfile().aidEfficacyWeights["paragraph-focus"]).toBe(1.0);

    act(() => {
      vi.advanceTimersByTime(FOCUS_AID_EVAL_MS);
    });
    expect(loadFocusTelemetryProfile().aidEfficacyWeights["paragraph-focus"]).toBe(1.1);
  });

  it("penaliza de inmediato si el usuario apaga la ayuda antes de 90 s y no duplica", () => {
    const activeSettings: ReaderSettings = { ...READER_DEFAULTS, paragraphFocus: true };
    const settingsRef = { current: activeSettings };

    act(() => {
      root.render(h(Probe, { settings: activeSettings, settingsRef }));
    });
    act(() => {
      api.scheduleFocusAidEvaluation("paragraph-focus");
    });

    const disabledSettings: ReaderSettings = { ...READER_DEFAULTS, paragraphFocus: false };
    settingsRef.current = disabledSettings;
    act(() => {
      root.render(h(Probe, { settings: disabledSettings, settingsRef }));
    });

    // 0.8 * 1.0 + 0.2 * 0.4 = 0.88
    expect(loadFocusTelemetryProfile().aidEfficacyWeights["paragraph-focus"]).toBe(0.88);

    act(() => {
      vi.advanceTimersByTime(FOCUS_AID_EVAL_MS);
    });
    expect(loadFocusTelemetryProfile().aidEfficacyWeights["paragraph-focus"]).toBe(0.88);
  });

  it("limpia el timer al desmontar sin emitir señal espuria", () => {
    const activeSettings: ReaderSettings = { ...READER_DEFAULTS, focusRuler: true };
    const settingsRef = { current: activeSettings };

    act(() => {
      root.render(h(Probe, { settings: activeSettings, settingsRef }));
    });
    act(() => {
      api.scheduleFocusAidEvaluation("focus-ruler");
    });
    act(() => {
      root.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(FOCUS_AID_EVAL_MS);
    });

    expect(loadFocusTelemetryProfile().aidEfficacyWeights["focus-ruler"]).toBe(0.9);
  });
});
