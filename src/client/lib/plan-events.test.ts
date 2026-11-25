import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPlanEventsForTests, trackPlanEvent } from "./plan-events";

describe("trackPlanEvent", () => {
  beforeEach(() => resetPlanEventsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("deduplica por evento y manda a /api/landing-events", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    trackPlanEvent("app:paywall");
    trackPlanEvent("app:paywall");
    trackPlanEvent("app:carne-open");
    expect(beacon).toHaveBeenCalledTimes(2);
    expect(beacon.mock.calls[0]).toEqual(["/api/landing-events", expect.stringContaining('"app:paywall"')]);
  });

  it("sin sendBeacon o si lanza, no hace nada ni rompe", () => {
    vi.stubGlobal("navigator", {});
    expect(() => trackPlanEvent("app:paywall")).not.toThrow();
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("x");
      },
    });
    expect(() => trackPlanEvent("app:carne-open")).not.toThrow();
  });
});
