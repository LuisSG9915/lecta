// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttachBookSheet from "./AttachBookSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let plan: string | null = "free";
vi.mock("../lib/account-plan", () => ({
  useUserPlan: () => (plan ? { plan } : null),
}));

describe("AttachBookSheet: nota de la nube por plan", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = () =>
    act(() =>
      root.render(
        h(AttachBookSheet, {
          item: { hash: "ab", name: "x.epub", addedAt: 1, remoteOnly: true, hasFile: false },
          onClose: vi.fn(),
          onAttached: vi.fn(),
          onOpenCarne: vi.fn(),
        }),
      ),
    );

  it("free ve la nota", () => {
    plan = "free";
    render();
    expect(document.body.textContent).toContain("Biblioteca en la nube");
  });
  it.each(["lecta_plus", "founder_lifetime"])("%s no la ve", (p) => {
    plan = p;
    render();
    expect(document.body.textContent).not.toContain("Biblioteca en la nube");
  });
  it("plan aún sin cargar (null) no la muestra", () => {
    plan = null;
    render();
    expect(document.body.textContent).not.toContain("Biblioteca en la nube");
  });
});
