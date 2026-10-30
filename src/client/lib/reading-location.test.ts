// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  anchorAtViewTop,
  normalizeBlockText,
  scrollToAnchor,
  scrollToFragment,
  charOffsetAtViewTop,
  charOffsetOfElementInChapter,
  keepAnchorStable,
  viewTopAnchor,
} from "./reading-location";

// jsdom no implementa scrollIntoView ni geometría real: se simulan.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

const block = (text: string, top: number, height = 40) => {
  const el = document.createElement("p");
  el.textContent = text;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
};

const container = (...els: HTMLElement[]) => {
  const c = document.createElement("div");
  c.append(...els);
  return c;
};

describe("normalizeBlockText", () => {
  it("colapsa espacios y recorta bordes", () => {
    expect(normalizeBlockText("  la   casa\n\n azul ")).toBe("la casa azul");
  });
});

describe("anchorAtViewTop", () => {
  it("ancla el primer bloque que cruza la zona de lectura", () => {
    const above = block("capítulo ya leído", -200, 100); // bottom -100: fuera
    const current = block("La casa   de los espíritus", -20, 60);
    const below = block("párrafo siguiente", 300);
    const c = container(above, current, below);

    const anchor = anchorAtViewTop(c);
    expect(anchor).toBe("La casa de los espíritus");
  });

  it("devuelve null sin bloques con texto", () => {
    expect(anchorAtViewTop(container(document.createElement("div")))).toBeNull();
  });
});

describe("viewTopAnchor", () => {
  it("calcula qué fracción del bloque quedó por encima de la ventana", () => {
    const above = block("ya leído", -300, 100); // fuera por completo
    const current = block("La casa de los espíritus", -30, 60); // mitad fuera
    const c = container(above, current);

    expect(viewTopAnchor(c)).toEqual({
      text: "La casa de los espíritus",
      offset: 0.5,
    });
  });

  it("no inventa fracción cuando el bloque empieza dentro de la ventana", () => {
    const c = container(block("Primer párrafo visible", 40, 60));

    expect(viewTopAnchor(c)?.offset).toBe(0);
  });
});

describe("scrollToAnchor", () => {
  it("encuentra el bloque por su inicio y lo desplaza", () => {
    const p1 = block("Era una mañana clara", 0);
    const p2 = block("El mar estaba en calma", 200);
    const c = container(p1, p2);
    const spy = vi.spyOn(p2, "scrollIntoView");

    expect(scrollToAnchor(c, "El mar estaba en calma y el cielo")).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: "start" });
  });

  it("aplica la clase resume-anchor si markResume es true", () => {
    const p = block("Párrafo de reanudación", 100);
    const c = container(p);
    vi.spyOn(p, "scrollIntoView");

    scrollToAnchor(c, "Párrafo de reanudación", { markResume: true });
    expect(p.classList.contains("resume-anchor")).toBe(true);
  });

  it("devuelve false cuando el ancla no está en la sección", () => {
    const c = container(block("otro texto", 0));
    expect(scrollToAnchor(c, "un ancla que no existe")).toBe(false);
  });

  it("recoloca la fracción ya leída dentro del bloque en vez de su inicio", () => {
    const p1 = block("Era una mañana clara", 0, 100);
    const p2 = block("El mar estaba en calma y el cielo", 400, 200);
    const c = container(p1, p2);
    const scrollTo = vi.fn();
    const original = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    const docHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "scrollHeight",
    );
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 4000,
      configurable: true,
    });

    try {
      // Ya se había leído la mitad del párrafo.
      expect(scrollToAnchor(c, "El mar estaba en calma", { offset: 0.5 })).toBe(true);
    } finally {
      window.scrollTo = original;
      if (docHeight) {
        Object.defineProperty(document.documentElement, "scrollHeight", docHeight);
      }
    }

    // 400 (arriba del bloque) − 0.5 × 200 (mitad leída) = 300.
    expect(scrollTo).toHaveBeenCalledWith(0, 300);
  });

  it("prefiere el bloque que empieza con el ancla antes que uno corto que lo contiene", () => {
    // Un epígrafe de dos palabras casaba con media sección y dejaba la
    // lectura antes del punto real.
    const epigraph = block("El mar", 0);
    const real = block("El mar estaba en calma y el cielo era de plomo", 200);
    const c = container(epigraph, real);

    expect(
      scrollToAnchor(c, "El mar estaba en calma y el cielo era de plomo", {
        markResume: true,
      }),
    ).toBe(true);
    expect(real.classList.contains("resume-anchor")).toBe(true);
    expect(epigraph.classList.contains("resume-anchor")).toBe(false);
  });
});

describe("scrollToFragment", () => {
  it("desplaza al elemento con ese id", () => {
    const target = block("Segunda parte del capítulo", 200);
    target.setAttribute("data-frag-id", "s2");
    const c = container(block("primera parte", 0), target);
    const spy = vi.spyOn(target, "scrollIntoView");

    expect(scrollToFragment(c, "s2")).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: "start" });
  });

  it("devuelve false si el id no existe", () => {
    const c = container(block("texto", 0));
    expect(scrollToFragment(c, "inexistente")).toBe(false);
  });
});

describe("charOffsetAtViewTop and charOffsetOfElementInChapter", () => {
  it("calcula el offset exacto en caracteres del bloque visible", () => {
    const p1 = block("Primer párrafo del capítulo.", -150, 40);
    const p2 = block("Segundo párrafo con datos importantes.", 50, 40);
    const p3 = block("Tercer párrafo con posibles spoilers.", 250, 40);
    const c = container(p1, p2, p3);

    const fullChapterText =
      "Primer párrafo del capítulo. Segundo párrafo con datos importantes. Tercer párrafo con posibles spoilers.";

    const offset = charOffsetAtViewTop(c, fullChapterText);
    expect(offset).toBeGreaterThan(0);
    // El offset incluye hasta el final del segundo párrafo
    expect(fullChapterText.slice(0, offset)).toContain("Segundo párrafo con datos importantes.");
    // Y no contiene el tercer párrafo
    expect(fullChapterText.slice(0, offset)).not.toContain("posibles spoilers");

    const offsetOfP2 = charOffsetOfElementInChapter(c, p2, fullChapterText);
    expect(offsetOfP2).toBeGreaterThan(0);
    expect(fullChapterText.slice(0, offsetOfP2)).toContain("Segundo párrafo con datos importantes.");
  });
});

describe("keepAnchorStable", () => {
  // El navegador real reflowea solo; aquí se simulan alto del documento,
  // scroll y geometría para medir la corrección del desvío.
  const setup = (initial: {
    scrollY: number;
    docHeight?: number;
    innerHeight?: number;
  }) => {
    let scrollY = initial.scrollY;
    const scrollTo = vi.fn((_x: number, y: number) => {
      scrollY = y;
    });
    const scrollToOriginal = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: initial.innerHeight ?? 720,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: initial.docHeight ?? 3510,
    });
    return {
      scrollTo,
      restore: () => {
        window.scrollTo = scrollToOriginal;
        delete (window as unknown as { scrollY?: number }).scrollY;
      },
    };
  };

  // La vigilancia ignora bloques que ya no están montados: el contenedor
  // se cuelga del documento, como en el lector.
  const mount = (c: HTMLElement) => {
    document.body.append(c);
    return () => c.remove();
  };

  it("devuelve el bloque a su sitio cuando el contenido creció por arriba", () => {
    vi.useFakeTimers();
    // Guardado: media página dentro de un párrafo de 208 px.
    // Tras restaurar, el párrafo empezó 508 px más abajo (fuentes,
    // imágenes): el lector aparece 621 px antes de donde estaba.
    const el = block("P05 · Mano mano ventana papel", 508, 208);
    const c = container(el);
    const unmount = mount(c);
    const env = setup({ scrollY: 122 });

    try {
      const stop = keepAnchorStable(c, "P05 · Mano mano ventana papel", 0.5468);
      vi.advanceTimersByTime(32);
      stop();
      expect(env.scrollTo).toHaveBeenCalled();
      const [, y] = env.scrollTo.mock.calls[0];
      // 122 + 508 + 0.5468 × 208 ≈ 743,7
      expect(y).toBeGreaterThan(740);
      expect(y).toBeLessThan(747);
    } finally {
      vi.useRealTimers();
      env.restore();
      unmount();
    }
  });

  it("no toca nada cuando el bloque ya está en su sitio", () => {
    vi.useFakeTimers();
    const el = block("P05 · Mano mano", -114, 208);
    const c = container(el);
    const unmount = mount(c);
    const env = setup({ scrollY: 744 });

    try {
      const stop = keepAnchorStable(c, "P05 · Mano mano", 0.5468);
      vi.advanceTimersByTime(32);
      stop();
      expect(env.scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      env.restore();
      unmount();
    }
  });

  it("se aparta en cuanto la persona toca la pantalla", () => {
    vi.useFakeTimers();
    const el = block("P05 · Mano mano", 508, 208);
    const c = container(el);
    const unmount = mount(c);
    const env = setup({ scrollY: 122 });

    try {
      const stop = keepAnchorStable(c, "P05 · Mano mano", 0.5468);
      window.dispatchEvent(new Event("wheel"));
      vi.advanceTimersByTime(64);
      stop();
      expect(env.scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      env.restore();
      unmount();
    }
  });

  it("sigue re-estabilizando ante carga tardía de imágenes mientras no haya interacción humana", () => {
    vi.useFakeTimers();
    const el = block("P05 · Mano mano", 508, 208);
    const img = document.createElement("img");
    el.appendChild(img);
    const c = container(el);
    const unmount = mount(c);
    const env = setup({ scrollY: 122 });

    try {
      const stop = keepAnchorStable(c, "P05 · Mano mano", 0.5468, { durationMs: 50, mediaTimeoutMs: 1000 });
      vi.advanceTimersByTime(100);
      env.scrollTo.mockClear();

      img.dispatchEvent(new Event("load"));
      expect(env.scrollTo).toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
      env.restore();
      unmount();
    }
  });
});
