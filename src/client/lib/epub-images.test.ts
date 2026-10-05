// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateSectionImages } from "./epub";

const BLOB_BASE = "https://blob.test/";

function stubObjectUrls() {
  let seq = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const url = `${BLOB_BASE}${++seq}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
  return { created, revoked };
}

const section = {
  resolveHref: (href: string) => `OEBPS/${href}`,
};

const loadBlob = (map: Record<string, Blob>) => (name: string) =>
  Promise.resolve(map[name] ?? null);

const div = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("hydrateSectionImages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sustituye la ruta interna por una blob: URL resuelta desde la sección", async () => {
    const { created } = stubObjectUrls();
    const root = div(`<p>Texto <img src="images/pic.png" alt="foto"></p>`);
    const urls: string[] = [];
    await hydrateSectionImages(
      root,
      section,
      loadBlob({ "OEBPS/images/pic.png": new Blob(["x"]) }),
      urls,
      { isCurrent: () => true },
    );
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(created[0]);
    expect(urls).toEqual(created);
  });

  it("deja intactas las URL externas y data:", async () => {
    const { created } = stubObjectUrls();
    const root = div(
      `<img src="https://cdn.test/a.png"><img src="data:image/png;base64,AA==">`,
    );
    await hydrateSectionImages(root, section, loadBlob({}), [], {
      isCurrent: () => true,
    });
    const [a, b] = [...root.querySelectorAll("img")];
    expect(a.getAttribute("src")).toBe("https://cdn.test/a.png");
    expect(b.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(created).toHaveLength(0);
  });

  it("resuelve <image> svg por xlink:href o href", async () => {
    const { created } = stubObjectUrls();
    const root = div(
      `<svg viewBox="0 0 10 10"><image xlink:href="cover.jpg"/></svg>` +
        `<svg viewBox="0 0 10 10"><image href="fig.png"/></svg>`,
    );
    await hydrateSectionImages(
      root,
      section,
      loadBlob({
        "OEBPS/cover.jpg": new Blob(["x"]),
        "OEBPS/fig.png": new Blob(["x"]),
      }),
      [],
      { isCurrent: () => true },
    );
    const images = [...root.querySelectorAll("image")];
    expect(images[0].getAttribute("href")).toBe(created[0]);
    expect(images[1].getAttribute("href")).toBe(created[1]);
  });

  it("revoca las URL de la sección anterior al empezar", async () => {
    const { created, revoked } = stubObjectUrls();
    const urls = ["https://blob.test/old-1", "https://blob.test/old-2"];
    const root = div(`<img src="a.png">`);
    await hydrateSectionImages(
      root,
      section,
      loadBlob({ "OEBPS/a.png": new Blob(["x"]) }),
      urls,
      { isCurrent: () => true },
    );
    expect(revoked).toEqual(["https://blob.test/old-1", "https://blob.test/old-2"]);
    expect(urls).toEqual(created);
  });

  it("deduplica imágenes repetidas y no escribe si la sección cambió", async () => {
    stubObjectUrls();
    const loader = vi.fn(loadBlob({ "OEBPS/x.png": new Blob(["x"]) }));
    const root = div(`<img src="x.png"><img src="x.png">`);
    await hydrateSectionImages(root, section, loader, [], {
      isCurrent: () => false,
    });
    expect(loader).toHaveBeenCalledTimes(1);
    for (const img of root.querySelectorAll("img"))
      expect(img.getAttribute("src")).toBeNull();
  });

  it("llama onSettled solo si la sección sigue vigente", async () => {
    stubObjectUrls();
    const root = div(`<img src="a.png">`);
    const settled = vi.fn();
    await hydrateSectionImages(
      root,
      section,
      loadBlob({ "OEBPS/a.png": new Blob(["x"]) }),
      [],
      { isCurrent: () => false, onSettled: settled },
    );
    expect(settled).not.toHaveBeenCalled();
  });
});
