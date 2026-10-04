import { useEffect, useRef, useState } from "react";
import type { LexiconEntry } from "../lib/lexicon";
import { enrichWord, lookupWord } from "../lib/lexicon";
import { loadSavedWord, saveWord, type SavedWord } from "../lib/idb";
import { pushWordsToServer } from "../lib/vocab";

type WordPanelProps = {
  word: string;
  context?: string;
  language: string;
  bookHash: string;
  onClose: () => void;
  onSaved: (word: SavedWord) => void;
};

type LookupState =
  | { kind: "loading" }
  | { kind: "found"; entries: LexiconEntry[] }
  | { kind: "notFound" }
  | { kind: "enriching" }
  | { kind: "error"; message: string };

export default function WordPanel({ word, context, language, bookHash, onClose, onSaved }: WordPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSavedWord(language, word).then((stored) => {
      if (!cancelled && stored) setSaved(true);
    });
    void lookupWord(word, language).then((result) => {
      if (cancelled) return;
      if (!result.ok) setLookup({ kind: "error", message: result.error });
      else if (!result.found) setLookup({ kind: "notFound" });
      else setLookup({ kind: "found", entries: result.entries });
    });
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [word, language, onClose]);

  const primary = lookup.kind === "found" ? lookup.entries[0] : undefined;

  const enrich = async () => {
    setLookup({ kind: "enriching" });
    const result = await enrichWord(word, language, context);
    if (!result.ok) setLookup({ kind: "error", message: result.error });
    else setLookup({ kind: "found", entries: result.entries });
  };

  const save = async () => {
    const entry = await saveWord({
      form: word,
      lemma: primary?.lemma,
      pos: primary?.pos,
      meaning: primary?.senses[0]?.definition,
      language,
      context,
      bookHash,
    });
    setSaved(true);
    void pushWordsToServer([entry]);
    onSaved(entry);
  };

  return (
    <div className="word-panel" role="dialog" aria-modal="true" aria-label={`Palabra ${word}`}>
      <div className="word-panel-header">
        <strong>{word}</strong>
        {primary?.pos ? <span className="reader-meta">{primary.pos}</span> : null}
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar panel de palabra">
          Cerrar
        </button>
      </div>

      {context ? <p className="word-context">“{context}”</p> : null}

      {lookup.kind === "loading" ? <p>Buscando en el catálogo…</p> : null}
      {lookup.kind === "enriching" ? <p>Consultando la ficha…</p> : null}
      {lookup.kind === "error" ? <p role="alert" className="error">{lookup.message}</p> : null}
      {lookup.kind === "notFound" ? (
        <>
          <p>No está en el catálogo todavía.</p>
          <button type="button" onClick={() => void enrich()}>
            Definir con IA
          </button>
        </>
      ) : null}
      {lookup.kind === "found"
        ? lookup.entries.map((entry) => (
            <div key={`${entry.lemma}:${entry.pos ?? ""}`} className="word-entry">
              {entry.lemma !== word ? <p className="reader-meta">Forma de «{entry.lemma}»</p> : null}
              {entry.senses.map((sense, index) => (
                <p key={index}>{sense.definition}</p>
              ))}
            </div>
          ))
        : null}

      <button type="button" onClick={() => void save()} disabled={saved}>
        {saved ? "Guardada" : "Guardar palabra"}
      </button>
    </div>
  );
}
