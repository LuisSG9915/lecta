// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttachBookSheet, { ATTACH_MISMATCH_MESSAGE } from "./AttachBookSheet";
import * as idbModule from "../lib/idb";
import { sha256Hex } from "../lib/hash";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bytes = new Uint8Array(readFileSync(resolve(__dirname, "../../../fixtures/minimal.epub")));
const epub = () => new File([bytes], "mi-libro.epub", { type: "application/epub+zip" });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u1", generation: 1 } as never);
  vi.spyOn(idbModule, "updateBookMeta").mockResolvedValue(undefined as never);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const choose = async (file: File) => {
  const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  for (let i = 0; i < 20; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

describe("AttachBookSheet", () => {
  it("el mismo archivo se guarda y abre el libro", async () => {
    const hash = await sha256Hex(epub());
    const save = vi.spyOn(idbModule, "saveBook").mockResolvedValue({} as never);
    const onAttached = vi.fn();
    act(() =>
      root.render(
        h(AttachBookSheet, {
          item: { hash, name: "x.epub", addedAt: 1, title: "Mi libro", remoteOnly: true, hasFile: false },
          onClose: vi.fn(),
          onAttached,
          onOpenCarne: vi.fn(),
        }),
      ),
    );
    await choose(epub());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ hash, name: "mi-libro.epub" }), expect.anything());
    expect(onAttached).toHaveBeenCalled();
  });

  it("un archivo distinto muestra el aviso y no escribe nada", async () => {
    const save = vi.spyOn(idbModule, "saveBook").mockResolvedValue({} as never);
    const onAttached = vi.fn();
    act(() =>
      root.render(
        h(AttachBookSheet, {
          item: { hash: "00".repeat(32), name: "x.epub", addedAt: 1, remoteOnly: true, hasFile: false },
          onClose: vi.fn(),
          onAttached,
          onOpenCarne: vi.fn(),
        }),
      ),
    );
    await choose(epub());
    expect(document.body.textContent).toContain(ATTACH_MISMATCH_MESSAGE);
    expect(save).not.toHaveBeenCalled();
    expect(onAttached).not.toHaveBeenCalled();
  });
});
