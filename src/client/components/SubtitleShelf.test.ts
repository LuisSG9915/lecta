// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubtitleShelf from "./SubtitleShelf";

// jsdom no decodifica imágenes (Image nunca dispara onload): el
// redimensionado real se prueba en cover.test; aquí se simula su salida.
const coverMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/cover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/cover")>()),
  coverToJpegBlob: coverMock,
}));
import type { ShelfItem } from "./Shelf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  coverMock.mockReset();
  coverMock.mockImplementation(async (blob: Blob) => blob);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

// 60 palabras distintas de verdad (letras base-26), para pasar el mínimo.
const word = (i: number) =>
  "wd" + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)) + "ing";
const srt = Array.from(
  { length: 60 },
  (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\nThe lighthouse keeper ${word(i)} onward.\n`,
).join("\n");

const render = async (props: Partial<Parameters<typeof SubtitleShelf>[0]> = {}) => {
  const onPrepareWork = props.onPrepareWork ?? vi.fn().mockResolvedValue(true);
  await act(async () => {
    root.render(
      h(SubtitleShelf, {
        works: [],
        onOpenWork: vi.fn(),
        onRemoveWork: vi.fn(),
        onPrepareWork,
        ...props,
      }),
    );
  });
  return onPrepareWork as ReturnType<typeof vi.fn>;
};

const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

const chooseFile = (file: File) => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const chooseImage = (file: File) => {
  const input = host.querySelector<HTMLInputElement>('input[accept="image/*"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const submit = () =>
  act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });

const work: ShelfItem = {
  hash: "a".repeat(64),
  name: "Dark",
  addedAt: 1,
  title: "Dark",
  author: "Serie",
  language: "en",
  mediaKind: "tv",
  paperOnly: true,
} as ShelfItem;

describe("SubtitleShelf", () => {
  it("sin archivo pide elegirlo y no prepara nada", async () => {
    const onPrepare = await render();
    await submit();
    expect(host.textContent).toContain("Elige el archivo de subtítulos.");
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("título vacío no prepara", async () => {
    const onPrepare = await render();
    chooseFile(new File([srt], "ep.srt"));
    await submit();
    expect(host.textContent).toContain("Escribe el título");
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("un subtítulo válido entrega ref y guía «solo palabras»", async () => {
    const onPrepare = await render();
    setValue(host.querySelector<HTMLInputElement>("#subs-title")!, "Dark");
    chooseFile(new File([srt], "ep.srt"));
    await submit();
        expect(onPrepare).toHaveBeenCalledTimes(1);
    const arg = onPrepare.mock.calls[0][0];
    expect(arg.ref).toEqual({ type: "tv", title: "Dark", language: "en", season: 1, episode: 1 });
    expect(arg.guide.forms).toContain("lighthouse");
    expect(arg.guide.forms.every((f: string) => !/\s/.test(f))).toBe(true);
  });

  it("sin imagen no manda portada", async () => {
    const onPrepare = await render();
    setValue(host.querySelector<HTMLInputElement>("#subs-title")!, "Dark");
    chooseFile(new File([srt], "ep.srt"));
    await submit();
    expect(onPrepare.mock.calls[0][0].cover).toBeUndefined();
    expect(coverMock).not.toHaveBeenCalled();
  });

  it("con imagen manda la portada reducida", async () => {
    const small = new Blob(["jpeg"], { type: "image/jpeg" });
    coverMock.mockResolvedValue(small);
    const onPrepare = await render();
    setValue(host.querySelector<HTMLInputElement>("#subs-title")!, "Dark");
    chooseFile(new File([srt], "ep.srt"));
    chooseImage(new File(["png"], "poster.png", { type: "image/png" }));
    await submit();
    expect(coverMock).toHaveBeenCalledTimes(1);
    expect(onPrepare.mock.calls[0][0].cover).toBe(small);
  });

  it("un archivo que no es imagen se rechaza sin preparar", async () => {
    const onPrepare = await render();
    setValue(host.querySelector<HTMLInputElement>("#subs-title")!, "Dark");
    chooseFile(new File([srt], "ep.srt"));
    chooseImage(new File(["x"], "nota.txt", { type: "text/plain" }));
    await submit();
    expect(host.textContent).toContain("Esa imagen no sirve");
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("una imagen que no se pudo reducir (sigue grande) no se guarda", async () => {
    coverMock.mockResolvedValue(new Blob([new Uint8Array(500_000)], { type: "image/png" }));
    const onPrepare = await render();
    setValue(host.querySelector<HTMLInputElement>("#subs-title")!, "Dark");
    chooseFile(new File([srt], "ep.srt"));
    chooseImage(new File(["png"], "poster.png", { type: "image/png" }));
    await submit();
    expect(host.textContent).toContain("No pudimos usar esa imagen");
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("un archivo sin diálogo muestra el error y no prepara", async () => {
    const onPrepare = await render();
    setValue(host.querySelector<HTMLInputElement>("#subs-title")!, "Dark");
    chooseFile(new File(["1\n00:00:01,000 --> 00:00:02,000\nHi.\n"], "ep.srt"));
    await submit();
    expect(host.textContent).toContain("No encontramos suficiente diálogo");
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("película: no pide temporada ni episodio", async () => {
    await render();
    expect(host.textContent).toContain("Temporada");
    act(() => setValue(host.querySelector<HTMLSelectElement>("select")!, "movie"));
    expect(host.textContent).not.toContain("Temporada");
  });

  it("«Otro episodio» copia el título y avanza el episodio", async () => {
    await render({ works: [work] });
    const another = [...host.querySelectorAll("button")].find((b) => b.textContent === "Otro episodio")!;
    act(() => another.click());
    expect(host.querySelector<HTMLInputElement>("#subs-title")!.value).toBe("Dark");
  });

  it("quitar pide confirmación", async () => {
    const onRemoveWork = vi.fn();
    await render({ works: [work], onRemoveWork });
    act(() => (host.querySelector(".screen-work-remove") as HTMLButtonElement).click());
    expect(onRemoveWork).not.toHaveBeenCalled();
    const yes = [...host.querySelectorAll("button")].find((b) => b.textContent === "Sí, quitar")!;
    act(() => yes.click());
    expect(onRemoveWork).toHaveBeenCalledWith(work.hash);
  });
});
