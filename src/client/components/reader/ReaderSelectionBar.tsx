// Menú de acciones de selección del lector: pasaje (tinta, cita, preguntar)
// y píldora compacta offline para selección de 1 sola palabra (Fase 1 Anti-Missclick).
import { useEffect, useState } from "react";
import Icon from "../Icon";
import type { WordHit } from "../../lib/words";
import { lookupWord, lookupWordInMemory } from "../../lib/lexicon";
import { captureDbScope } from "../../lib/idb";

export type ReaderSelectionButton = {
  x: number;
  y: number;
  placement: "top" | "bottom";
  singleWordHit: WordHit | null;
};

export interface ReaderSelectionBarProps {
  selButton: ReaderSelectionButton | null;
  setSelButton: (value: ReaderSelectionButton | null) => void;
  openSelection: (hit: WordHit) => void;
  savePassageSelection: (tone: "amber" | "salvia" | "dario") => void | Promise<unknown>;
  openQuoteCardFromSelection: () => void;
  askCatAboutSelection: (param?: string | { word?: string; passage: string; bookId?: string }) => void | Promise<unknown>;
  setDeepModal: (value: boolean) => void;
  language?: string;
}

export function ReaderSelectionBar(props: ReaderSelectionBarProps) {
  const {
    selButton,
    setSelButton,
    openSelection,
    savePassageSelection,
    openQuoteCardFromSelection,
    askCatAboutSelection,
    setDeepModal,
    language = "es",
  } = props;

  // Auto-dismiss sin fricción: si el usuario hace scroll o toca fuera de la píldora/barra
  useEffect(() => {
    if (!selButton) return;
    const hide = () => setSelButton(null);
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".selection-menu")) return;
      hide();
    };

    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, [selButton, setSelButton]);

  // Etapa 1: Definición offline inmediata (<50ms, 0 red, 0 IA)
  const currentHit = selButton?.singleWordHit;
  const [offlineDef, setOfflineDef] = useState<{
    lemma: string;
    definition: string;
  } | null>(() => {
    if (!currentHit) return null;
    const form = currentHit.word;
    const mem = lookupWordInMemory(form, language);
    if (mem?.ok && mem.found && mem.entries && mem.entries.length > 0) {
      const def =
        mem.entries[0]?.senses?.[0]?.definition ||
        mem.definitions?.[0] ||
        "";
      const lemma = mem.entries[0]?.lemma || mem.lemma || form;
      return { lemma, definition: def };
    }
    return null;
  });

  useEffect(() => {
    if (!currentHit) {
      return;
    }
    const form = currentHit.word;
    let cancelled = false;
    const scope = captureDbScope();
    void lookupWord(form, language, scope)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.found && res.entries && res.entries.length > 0) {
          const def =
            res.entries[0]?.senses?.[0]?.definition ||
            res.definitions?.[0] ||
            "";
          const lemma = res.entries[0]?.lemma || res.lemma || form;
          setOfflineDef({ lemma, definition: def });
        } else {
          setOfflineDef((prev) => (prev?.definition ? prev : { lemma: form, definition: "" }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setOfflineDef((prev) => (prev?.definition ? prev : { lemma: form, definition: "" }));
      });

    return () => {
      cancelled = true;
    };
  }, [currentHit, language]);

  if (!selButton) return null;

  // Etapa 1: Píldora compacta de 1 sola palabra
  if (selButton.singleWordHit) {
    const hit = selButton.singleWordHit;
    return (
      <div
        className="selection-menu reader__word-pill"
        data-placement={selButton.placement}
        style={{ left: selButton.x, top: selButton.y }}
        role="dialog"
        aria-label={`Definición de ${hit.word}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader__word-pill-content">
          <div className="reader__word-pill-header">
            <strong className="reader__word-pill-lemma">
              {offlineDef?.lemma || hit.word}
            </strong>
            {offlineDef?.lemma &&
              offlineDef.lemma.toLowerCase() !== hit.word.toLowerCase() && (
                <span className="reader__word-pill-surface">({hit.word})</span>
              )}
          </div>
          {offlineDef?.definition ? (
            <p className="reader__word-pill-def">{offlineDef.definition}</p>
          ) : (
            <p className="reader__word-pill-def reader__word-pill-def--empty">
              Consultando diccionario local...
            </p>
          )}
        </div>

        <div className="reader__word-pill-actions">
          <button
            type="button"
            className="reader__word-pill-btn-cat"
            title="Ver matiz en la frase con el compañero"
            aria-label="Ver matiz en la frase"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setSelButton(null);
              void askCatAboutSelection({ word: hit.word, passage: hit.context || hit.word });
            }}
          >
            <span>🐾 Ver matiz en la frase</span>
          </button>
          <button
            type="button"
            className="reader__word-pill-btn-define"
            title="Abrir ficha completa"
            aria-label="Abrir ficha completa"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              window.getSelection()?.removeAllRanges();
              setSelButton(null);
              openSelection(hit);
            }}
          >
            <span>Ficha</span>
          </button>
        </div>
      </div>
    );
  }

  // Etapa 2: Barra de pasajes (>1 palabra)
  return (
    <div
      className="selection-menu reader__passage-bar"
      data-placement={selButton.placement}
      style={{ left: selButton.x, top: selButton.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* 1. Resaltar con tinta (3 tonos: Ámbar, Salvia, Azul Darío) */}
      <div className="selection-highlight-group" role="group" aria-label="Resaltar con tinta">
        <button
          type="button"
          className="selection-menu-btn selection-save"
          title="Resaltar con tinta ámbar"
          aria-label="Resaltar con tinta"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void savePassageSelection("amber")}
        >
          <Icon name="highlight" size={14} />
          <span>Tinta</span>
        </button>
        <div className="selection-tones-picker" aria-label="Elegir tono de tinta">
          <button
            type="button"
            className="tone-dot tone-dot--amber reader__passage-color reader__passage-color--amber"
            title="Tinta Ámbar"
            aria-label="Tinta Ámbar"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("amber")}
          />
          <button
            type="button"
            className="tone-dot tone-dot--salvia reader__passage-color reader__passage-color--sage"
            title="Tinta Salvia"
            aria-label="Tinta Salvia"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("salvia")}
          />
          <button
            type="button"
            className="tone-dot tone-dot--dario reader__passage-color reader__passage-color--dario-blue"
            title="Tinta Azul Darío"
            aria-label="Tinta Azul Darío"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("dario")}
          />
        </div>
      </div>

      {/* 2. Reflexión Profunda */}
      <button
        type="button"
        className="selection-menu-btn selection-deep"
        title="Reflexión Profunda"
        aria-label="Reflexión Profunda"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          window.getSelection()?.removeAllRanges();
          setSelButton(null);
          setDeepModal(true);
        }}
      >
        <Icon name="retreat" size={14} />
        <span>Reflexión</span>
      </button>

      {/* 3. Crear Postal de Cita */}
      <button
        type="button"
        className="selection-menu-btn selection-card"
        title="Crear postal de cita"
        aria-label="Crear postal de cita"
        onPointerDown={(event) => event.preventDefault()}
        onClick={openQuoteCardFromSelection}
      >
        <Icon name="quote" size={14} />
        <span>Postal</span>
      </button>

      {/* 4. Preguntar al Gato */}
      <button
        type="button"
        className="selection-menu-btn selection-ask-cat"
        title="Preguntar al Gato"
        aria-label="Preguntar al Gato"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void askCatAboutSelection()}
      >
        <Icon name="sparkles" size={14} />
        <span>Preguntar</span>
      </button>
    </div>
  );
}
