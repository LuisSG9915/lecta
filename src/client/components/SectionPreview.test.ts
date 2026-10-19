// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectionPreview, {
  type SectionPreviewProps,
  type SectionPreviewRow,
} from "./SectionPreview";
import type { PreparationAnswers } from "../lib/preparation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
  document.body.innerHTML = "";
});

const row = (
  key: string,
  extra: Partial<SectionPreviewRow> = {},
): SectionPreviewRow => ({ key, form: `forma-${key}`, meaning: "def", ...extra });

const base = (over: Partial<SectionPreviewProps> = {}): SectionPreviewProps => ({
  title: "Capítulo 1",
  analysis: "ready",
  rows: [row("es:casa"), row("es:perenne")],
  answers: {},
  saving: false,
  onAnswer: vi.fn(),
  onConfirm: vi.fn(),
  onSkip: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
  onDiscard: vi.fn(),
  ...over,
});

const render = (props: SectionPreviewProps) =>
  act(() => root.render(h(SectionPreview, props)));

const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) =>
  act(() => {
    button(label).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });

describe("SectionPreview", () => {
  it("tres estados: conocer, desconocer y pendiente se reportan explícitos", () => {
    const props = base();
    render(props);
    click("La conozco");
    expect(props.onAnswer).toHaveBeenCalledWith("es:casa", "known");
    click("No la conozco");
    expect(props.onAnswer).toHaveBeenCalledWith("es:casa", "unknown");
    // Sin respuesta la fila queda pendiente: nada marcado.
    const group = host.querySelector("[role='group']")!;
    for (const btn of group.querySelectorAll("button"))
      expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("dos filas del mismo lema mantienen claves y respuestas independientes", () => {
    const props = base({
      rows: [
        row("es:banco", { form: "banco" }),
        row("es:banco#2", { form: "banco" }),
      ],
      answers: { "es:banco": "known" },
    });
    render(props);
    const groups = host.querySelectorAll("[role='group']");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector("[aria-pressed='true']")).not.toBeNull();
    expect(groups[1].querySelector("[aria-pressed='true']")).toBeNull();
  });

  it("muestra 8 primero y «Ver más» revela el resto sin perder respuestas", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`es:w${i}`));
    const answers: PreparationAnswers = { "es:w0": "unknown" };
    const props = base({ rows, answers });
    render(props);
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(8);
    click("Ver 2 más");
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(10);
    expect(
      host.querySelector(".section-preview-item [aria-pressed='true']"),
    ).not.toBeNull();
  });

  it("agrupa nuevas, por aprender y sin definición", () => {
    render(
      base({
        rows: [
          row("es:nueva"),
          row("es:aprendiendo", { learning: true }),
          row("es:sindef", { meaning: undefined }),
        ],
      }),
    );
    expect(text()).toContain("Palabras nuevas");
    expect(text()).toContain("Que estás aprendiendo");
    expect(text()).toContain("Sin definición todavía");
  });

  it("carga muestra aviso y conserva la salida «Leer sin preparar»", () => {
    const props = base({ analysis: "loading", rows: [] });
    render(props);
    expect(text()).toContain("Preparando vocabulario");
    click("Leer sin preparar");
    expect(props.onSkip).toHaveBeenCalled();
  });

  it("error ofrece reintentar y leer sin preparar", () => {
    const props = base({ analysis: "error", rows: [] });
    render(props);
    expect(host.querySelector("[role='alert']")).not.toBeNull();
    click("Reintentar");
    expect(props.onRetry).toHaveBeenCalled();
    click("Leer sin preparar");
    expect(props.onSkip).toHaveBeenCalled();
  });

  it("vacío explica que no hay nada que preparar y sale a leer", () => {
    const props = base({ rows: [] });
    render(props);
    expect(text()).toContain("Nada que preparar");
    click("Leer");
    expect(props.onSkip).toHaveBeenCalled();
  });

  it("saving bloquea un segundo envío y las respuestas", () => {
    const props = base({ saving: true, answers: { "es:casa": "known" } });
    render(props);
    const confirm = button("Guardando…") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    click("Guardando…");
    expect(props.onConfirm).not.toHaveBeenCalled();
    const choice = host.querySelector(
      ".cal-choice",
    ) as HTMLButtonElement;
    expect(choice.disabled).toBe(true);
  });

  it("consultar definición dentro de la hoja no toca las respuestas", () => {
    const props = base({ answers: { "es:casa": "known" } });
    render(props);
    const open = host.querySelector(".section-preview-open") as HTMLElement;
    act(() => {
      open.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector(".section-preview-def")).not.toBeNull();
    // Sigue sin abrir otra ficha ni alterar respuestas controladas.
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(
      host.querySelector(".cal-choice[aria-pressed='true']"),
    ).not.toBeNull();
  });

  it("una definición que llega tarde se actualiza en su lugar (misma clave)", () => {
    // Mismo grupo, misma clave: React reutiliza el nodo y solo cambia el texto.
    const props = base({ rows: [row("es:tardia", { meaning: "def vieja" })] });
    render(props);
    const open = host.querySelector(".section-preview-open") as HTMLElement;
    act(() => {
      open.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const item = host.querySelector(".section-preview-item")!;
    expect(item.textContent).toContain("def vieja");
    render(
      base({ ...props, rows: [row("es:tardia", { meaning: "def tardía" })] }),
    );
    const updated = host.querySelector(".section-preview-item")!;
    expect(updated).toBe(item);
    expect(updated.textContent).toContain("def tardía");
  });

  it("descartar pide confirmación en la misma hoja, sin diálogo apilado", () => {
    const props = base({ answers: { "es:casa": "unknown" } });
    render(props);
    click("Descartar respuestas");
    expect(text()).toContain("¿Descartar las respuestas marcadas?");
    click("Conservar");
    expect(props.onDiscard).not.toHaveBeenCalled();
    click("Descartar respuestas");
    click("Sí, descartar");
    expect(props.onDiscard).toHaveBeenCalled();
  });

  it("cerrar avisa al controlador (el borrador lo conserva él)", () => {
    const props = base();
    render(props);
    click("Cerrar");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("las diferidas quedan colapsadas, paginadas por 8 y respondibles", () => {
    const deferred = Array.from({ length: 10 }, (_, i) =>
      row(`es:d${i}`, { form: `dif${i}` }),
    );
    const props = base({ deferredRows: deferred, answers: {} });
    render(props);
    // Colapsadas: no estorban a la selección principal.
    expect(text()).toContain("más palabras de esta parte (10)");
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(2);

    click("Ver más palabras de esta parte (10)");
    // Paginadas por 8 como la lista principal.
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(10);
    click("Ver 2 más");
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(12);
    // Respondibles: siguen siendo filas con evidencia, no consulta
    // pasiva — una marcada desconocida entra al mismo lote.
    const groups = host.querySelectorAll("[role='group']");
    const last = groups[groups.length - 1];
    const unknownBtn = [...last.querySelectorAll("button")].find(
      (b) => b.textContent === "No la conozco",
    )!;
    act(() => {
      unknownBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(props.onAnswer).toHaveBeenCalledWith("es:d9", "unknown");
  });

  it("las diferidas solo registran presentación cuando se hacen visibles", () => {
    const presented: SectionPreviewRow[][] = [];
    const deferred = Array.from({ length: 10 }, (_, i) =>
      row(`es:d${i}`, { form: `dif${i}` }),
    );
    render(
      base({
        deferredRows: deferred,
        onRowsPresented: (rows) => presented.push(rows),
      }),
    );
    // Sin abrir la consulta no hubo presentación de diferidas.
    expect(presented.flat().map((row) => row.key)).not.toContain("es:d0");
    click("Ver más palabras de esta parte (10)");
    const last = presented[presented.length - 1].map((row) => row.key);
    // Solo las 8 visibles, no las que siguen paginadas.
    expect(last).toContain("es:d0");
    expect(last).toContain("es:d7");
    expect(last).not.toContain("es:d8");
  });

  describe("El Pórtico del Capítulo", () => {
    it("muestra la burbuja del gato con la estimación de tiempo y joyas léxicas", () => {
      render(base({ estimatedMinutes: 6, rows: [row("es:aurora"), row("es:candor")] }));
      expect(text()).toContain("Este capítulo se lee en ~6 min");
      expect(text()).toContain("Encontré 2 joyas léxicas");
    });

    it("el desbloqueo rápido de cartas revela el significado y suma +5 gotas de tinta", () => {
      const onUnlock = vi.fn();
      render(
        base({
          rows: [row("es:refulgente", { form: "refulgente", meaning: "Que emite resplandor" })],
          onUnlockCard: onUnlock,
        }),
      );

      const card = host.querySelector(".portico-card-3d") as HTMLElement;
      expect(card).toBeTruthy();
      expect(card.classList.contains("is-flipped")).toBe(false);

      // Al tocar la carta, gira y desbloquea +5 gotas de tinta
      act(() => {
        card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(card.classList.contains("is-flipped")).toBe(true);
      expect(card.classList.contains("section-preview__flash-card--expanded")).toBe(true);
      expect(host.querySelector(".section-preview__flash-word--back")?.textContent).toBe("refulgente");
      expect(text()).toContain("+5 gotas de tinta");
      expect(text()).toContain("Que emite resplandor");
      expect(onUnlock).toHaveBeenCalledWith(expect.objectContaining({ form: "refulgente" }));
    });

    it("al voltear una tarjeta se muestra el lema en la cara trasera y se aplica la clase expandida", () => {
      render(
        base({
          rows: [row("es:abigarrado", { form: "abigarrados", lemma: "abigarrado", meaning: "De varios colores mal combinados" })],
        }),
      );

      const card = host.querySelector(".section-preview__flash-card") as HTMLElement;
      expect(card).toBeTruthy();
      expect(card.classList.contains("section-preview__flash-card--expanded")).toBe(false);

      act(() => {
        card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(card.classList.contains("section-preview__flash-card--expanded")).toBe(true);
      const backWord = host.querySelector(".section-preview__flash-word--back");
      expect(backWord).toBeTruthy();
      expect(backWord?.textContent).toBe("abigarrado");
    });

    it("permite seleccionar una estrategia con 1 clic y entrar al capítulo", () => {
      const onSelectStrategy = vi.fn();
      const props = base({ onSelectStrategy });
      render(props);

      const chip = [...host.querySelectorAll(".portico-chip")].find(
        (c) => c.textContent?.includes("Explorador Léxico"),
      ) as HTMLButtonElement;
      expect(chip).toBeTruthy();

      act(() => {
        chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(onSelectStrategy).toHaveBeenCalledWith("lexical");

      click("Entrar al capítulo →");
      expect(props.onConfirm).toHaveBeenCalled();
    });
  });

  describe("mode === 'pill'", () => {
    it("renderiza únicamente la pastilla discreta y llama a onExpand al pulsar", () => {
      const onExpand = vi.fn();
      const props = base({
        mode: "pill",
        onExpand,
        words: [row("es:uno"), row("es:dos"), row("es:tres")],
      });
      render(props);

      const pill = host.querySelector<HTMLButtonElement>(".reader-section-preview-pill");
      expect(pill).toBeTruthy();
      expect(pill?.textContent).toBe("✨ 3 palabras clave en este capítulo · Ver");
      expect(host.querySelector(".dialog-scrim")).toBeNull();
      expect(host.querySelector(".portico-overlay")).toBeNull();

      act(() => {
        pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(onExpand).toHaveBeenCalled();
    });
  });

  describe("Umbral del Capítulo - Tarjeta Editorial Pre-Capítulo (Track 6)", () => {
    const primingWords = [
      {
        lemma: "vislumbrar",
        surfaceForm: "vislumbró",
        lang: "es",
        beta: 0.8,
        chapterFrequency: 2,
        partOfSpeech: "verb" as const,
        shortGloss: "Ver un objeto tenuemente.",
        contextSentence: "A lo lejos vislumbró una luz.",
        utilityScore: 1.25,
        unknownProbability: 0.65,
      },
      {
        lemma: "efímero",
        surfaceForm: "efímero",
        lang: "es",
        beta: 0.6,
        chapterFrequency: 3,
        partOfSpeech: "adj" as const,
        shortGloss: "Que dura poco tiempo.",
        contextSentence: "Un instante efímero de paz.",
        utilityScore: 1.15,
        unknownProbability: 0.55,
      },
    ];

    it("renderiza la tarjeta editorial limpia con encabezado, tiempo estimado y palabras", () => {
      render(
        base({
          bookId: "b1",
          chapterTitle: "Capítulo IV: La Niebla",
          bookLang: "es",
          userNativeLang: "es",
          words: primingWords,
          onMarkKnown: vi.fn(),
          onSaveToPractice: vi.fn(),
          onStartReading: vi.fn(),
        }),
      );

      expect(host.querySelector(".lecta-chapter-priming")).toBeTruthy();
      expect(text()).toContain("Capítulo IV: La Niebla");
      expect(text()).toContain("Antes de leer");
      expect(text()).toContain("2 palabras clave");
      expect(text()).toContain("vislumbró");
      expect(text()).toContain("efímero");
      expect(text()).toContain("A lo lejos vislumbró una luz.");
    });

    it("indica badge de idioma extranjero si bookLang != userNativeLang", () => {
      render(
        base({
          bookId: "b2",
          chapterTitle: "Chapter 1",
          bookLang: "en",
          userNativeLang: "es",
          words: [
            {
              lemma: "whisper",
              surfaceForm: "whispered",
              lang: "en",
              beta: 0.5,
              chapterFrequency: 2,
              partOfSpeech: "verb",
              shortGloss: "To speak softly",
              contextSentence: "He whispered in the dark.",
              utilityScore: 1.0,
              unknownProbability: 0.5,
            },
          ],
          onMarkKnown: vi.fn(),
          onSaveToPractice: vi.fn(),
          onStartReading: vi.fn(),
        }),
      );

      expect(text()).toContain("Lectura en EN");
    });

    it("botón '✓ Ya la sé' marca la palabra como conocida y la pliega de la lista", () => {
      const onMarkKnown = vi.fn();
      render(
        base({
          bookId: "b1",
          words: primingWords,
          onMarkKnown,
          onSaveToPractice: vi.fn(),
          onStartReading: vi.fn(),
        }),
      );

      const knownButtons = host.querySelectorAll(".lecta-priming-card__btn-known");
      expect(knownButtons.length).toBe(2);

      // Clic en '✓ Ya la sé' de la primera palabra ("vislumbrar")
      act(() => {
        knownButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(onMarkKnown).toHaveBeenCalledWith("vislumbrar", 0.8);
      // Ahora solo queda 1 tarjeta visible
      expect(host.querySelectorAll(".lecta-priming-card").length).toBe(1);
      expect(text()).not.toContain("vislumbró");
      expect(text()).toContain("efímero");
    });

    it("botón '+ Repasar' guarda la palabra para repaso y cambia su estado a Guardada", () => {
      const onSaveToPractice = vi.fn();
      render(
        base({
          bookId: "b1",
          words: primingWords,
          onMarkKnown: vi.fn(),
          onSaveToPractice,
          onStartReading: vi.fn(),
        }),
      );

      const saveButtons = host.querySelectorAll<HTMLButtonElement>(".lecta-priming-card__btn-save");
      expect(saveButtons[0].textContent).toContain("+ Repasar");

      act(() => {
        saveButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(onSaveToPractice).toHaveBeenCalledWith("vislumbrar", 0.8);
      expect(saveButtons[0].textContent).toContain("Guardada");
      expect(saveButtons[0].disabled).toBe(true);
    });

    it("botón de audio reproduce la pronunciación", () => {
      const onPronounce = vi.fn();
      render(
        base({
          bookId: "b1",
          words: primingWords,
          onPronounce,
          onMarkKnown: vi.fn(),
          onSaveToPractice: vi.fn(),
          onStartReading: vi.fn(),
        }),
      );

      const audioBtn = host.querySelector<HTMLButtonElement>(".lecta-priming-card__audio");
      act(() => {
        audioBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(onPronounce).toHaveBeenCalledWith("vislumbró", "es");
    });

    it("menú Opciones ▾ permite ocultar en este libro o desactivar globalmente", () => {
      const onMuteForBook = vi.fn();
      const onDisableGlobally = vi.fn();

      render(
        base({
          bookId: "test-book-42",
          words: primingWords,
          onMuteForBook,
          onDisableGlobally,
          onMarkKnown: vi.fn(),
          onSaveToPractice: vi.fn(),
          onStartReading: vi.fn(),
        }),
      );

      const optionsBtn = host.querySelector<HTMLButtonElement>(".lecta-chapter-priming__options-btn")!;
      expect(host.querySelector(".lecta-chapter-priming__dropdown")).toBeNull();

      // Abrir menú de opciones
      act(() => {
        optionsBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(host.querySelector(".lecta-chapter-priming__dropdown")).toBeTruthy();

      click("Ocultar en este libro");
      expect(onMuteForBook).toHaveBeenCalledWith("test-book-42");

      // Abrir de nuevo y desactivar globalmente
      act(() => {
        optionsBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      click("Desactivar pre-lectura siempre");
      expect(onDisableGlobally).toHaveBeenCalled();
    });

    it("botón 'Entrar al capítulo →' llama a onStartReading (Fase 2)", () => {
      const onStartReading = vi.fn();
      render(
        base({
          bookId: "b1",
          words: primingWords,
          onStartReading,
          onMarkKnown: vi.fn(),
          onSaveToPractice: vi.fn(),
        }),
      );

      click("Entrar al capítulo →");
      expect(onStartReading).toHaveBeenCalled();
    });

    it("muestra el encabezado literario y empático de la Fase 2", () => {
      render(
        base({
          bookId: "b1",
          chapterTitle: "Capítulo II",
          words: primingWords,
          onMarkKnown: vi.fn(),
          onSaveToPractice: vi.fn(),
          onStartReading: vi.fn(),
        }),
      );

      expect(text()).toContain("✨ Lectura sin tropiezos · 20 seg");
      expect(text()).toContain("Palabras clave antes de entrar al capítulo");
      expect(text()).toContain(
        "Dales un vistazo rápido; así cuando aparezcan en la historia las leerás de corrido sin perder la magia.",
      );
      const knownBtns = host.querySelectorAll(".lecta-priming-card__btn-known");
      expect(knownBtns[0]?.textContent).toBe("✓ Ya la conozco");
    });
  });
});


