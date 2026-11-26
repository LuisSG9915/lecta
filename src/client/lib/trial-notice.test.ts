import { afterEach, describe, expect, it, vi } from "vitest";
import * as idb from "./idb";
import {
  dismissTrialNotice,
  isTrialNoticeDismissed,
  markTrialEndSeen,
  shouldShowTrialEnd,
  trialNoticeDay,
} from "./trial-notice";

const DAY = 86_400_000;
const END = Date.UTC(2026, 11, 9);

describe("trialNoticeDay", () => {
  it("fuera de 3 días no avisa", () => {
    expect(trialNoticeDay(END, END - 3 * DAY - 1)).toBeNull();
  });
  it("a exactamente 3 días, 3", () => expect(trialNoticeDay(END, END - 3 * DAY)).toBe(3));
  it("entre 2 y 3 días, 3; a 2 días, 2", () => {
    expect(trialNoticeDay(END, END - 2 * DAY - 1)).toBe(3);
    expect(trialNoticeDay(END, END - 2 * DAY)).toBe(2);
  });
  it("a 1 hora, 1", () => expect(trialNoticeDay(END, END - 3_600_000)).toBe(1));
  it("vencido o sin fecha, null", () => {
    expect(trialNoticeDay(END, END)).toBeNull();
    expect(trialNoticeDay(END, END + 1)).toBeNull();
    expect(trialNoticeDay(null, END)).toBeNull();
    expect(trialNoticeDay(undefined, END)).toBeNull();
  });
});

describe("marcas y hoja del día 15", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it("las marcas son por cuenta", () => {
    vi.spyOn(idb, "getActiveUserId").mockReturnValue("a");
    markTrialEndSeen();
    dismissTrialNotice(3);
    vi.spyOn(idb, "getActiveUserId").mockReturnValue("b");
    expect(shouldShowTrialEnd({ trialEndedAt: 1, bookOpen: false, deepLinkPending: false })).toBe(true);
    expect(isTrialNoticeDismissed(3)).toBe(false);
  });
  it("descarte por día", () => {
    expect(isTrialNoticeDismissed(2)).toBe(false);
    dismissTrialNotice(2);
    expect(isTrialNoticeDismissed(2)).toBe(true);
    expect(isTrialNoticeDismissed(1)).toBe(false);
  });
  it("no se monta sin trialEndedAt, con marca de vista, con libro ni con enlace directo", () => {
    const ok = { trialEndedAt: 1, bookOpen: false, deepLinkPending: false };
    expect(shouldShowTrialEnd(ok)).toBe(true);
    expect(shouldShowTrialEnd({ ...ok, trialEndedAt: undefined })).toBe(false);
    expect(shouldShowTrialEnd({ ...ok, bookOpen: true })).toBe(false);
    expect(shouldShowTrialEnd({ ...ok, deepLinkPending: true })).toBe(false);
    markTrialEndSeen();
    expect(shouldShowTrialEnd(ok)).toBe(false);
  });
});
