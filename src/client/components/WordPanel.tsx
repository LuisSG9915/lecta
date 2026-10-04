import { useEffect, useState } from "react";
import type { LexiconEntry } from "../lib/lexicon";
import { enrichWord, lookupWord } from "../lib/lexicon";
import { loadSavedWord, saveWord, type SavedWord } from "../lib/idb";
import { pushWordsToServer } from "../lib/vocab";
import Sheet from "./Sheet";

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
    return () => {
      cancelled = true;
    };
  }, [word, language]);

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
    <Sheet label={`Palabra ${word}`} onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">
          {word}
          {primary?.pos ? <span className="card-pos"> · {primary.pos}</span> : null}
        </strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar ficha"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {context ? <p className="card-context">“{context}”</p> : null}

      {lookup.kind === "loading" ? <p className="meta">Buscando en el catálogo…</p> : null}
      {lookup.kind === "enriching" ? <p className="meta">Consultando la ficha…</p> : null}
      {lookup.kind === "error" ? (
        <p role="alert" className="status">
          {lookup.message}
        </p>
      ) : null}
      {lookup.kind === "notFound" ? (
        <>
          <p className="meta">Aún no está en el catálogo.</p>
          <button type="button" className="btn" onClick={() => void enrich()}>
            Definir con IA
          </button>
        </>
      ) : null}
      {lookup.kind === "found"
        ? lookup.entries.map((entry) => (
            <div key={`${entry.lemma}:${entry.pos ?? ""}`} className="word-entry">
              {entry.lemma !== word ? (
                <p className="meta">Forma de «{entry.lemma}»</p>
              ) : null}
              <ol className="senses">
                {entry.senses.map((sense, index) => (
                  <li key={index}>{sense.definition}</li>
                ))}
              </ol>
            </div>
          ))
        : null}

      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saved}>
          {saved ? "En tu cuaderno" : "Guardar palabra"}
        </button>
      </div>
    </Sheet>
  );
}
