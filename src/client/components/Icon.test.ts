// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Icon, { type IconName } from "./Icon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const NAMES: IconName[] = [
  "shelf", "book", "notebook", "bookmark", "you", "journey", "index",
  "more", "search", "headphones", "stop", "fullscreen", "fullscreen-exit",
  "retreat", "cloud", "clock", "speaker", "back", "close", "strategy",
  "sparkles", "sparkle", "quote", "download", "focus", "lock", "highlight",
  "sliders", "chevron-right",
  "paw", "cat", "bulb", "trophy", "target", "users", "sprout", "trash",
  "pin", "droplet", "glasses", "gift", "zap", "wave", "edit", "shuffle",
  "shield", "compass", "star", "check", "pause", "skip-back",
  "skip-forward", "retry", "scroll", "chart", "shirt", "bowl", "text", "ban",
];

describe("Icon", () => {
  it("renderiza un svg accesible para cada nombre del catálogo", () => {
    for (const name of NAMES) {
      act(() => root.render(h(Icon, { name })));
      const svg = host.querySelector("svg");
      expect(svg, name).toBeTruthy();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.querySelectorAll("path, circle, rect, line, polyline, polygon").length, name).toBeGreaterThan(0);
      expect(svg!.getAttribute("class")).toContain(`icon--${name}`);
    }
  });
});
