import { useEffect, useState } from "react";
import type { LexiconEntry } from "../lib/lexicon";
import { enrichWord, lookupWord } from "../lib/lexicon";
import {
  loadSavedWord,
  removeSavedWord,
  saveWord,
  wordKey,
  type SavedWord,
} from "../lib/idb";
import { pushWordsToServer } from "../lib/vocab";
import Sheet from "./Sheet";

type WordPanelProps = {
  word: string;
  context?: string;
  language: string;
  bookHash: string;
  onClose: () => void;
  onSaved: (word: SavedWord) => void;
  onRemoved?: (word: SavedWord) => void;
};

type LookupState =
  | { kind: "loading" }
  | { kind: "found"; entries: LexiconEntry[] }
  | { kind: "notFound" }
  | { kind: "enriching" }
  | { kind: "error"; message: string };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// La oración-hábitat con la palabra marcada en bermellón.
function ContextQuote({ context, word }: { context: string; word: string }) {
  const parts = context.split(new RegExp(`(${escapeRegExp(word)})`, "i"));
  return (
    <p className="card-context">
      “
      {parts.map((part, index) =>
        index % 2 ? (
          <mark key={index} className="ctx-word">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
      ”
    </p>
  );
}

export default function WordPanel({
  word,
  context,
  language,
  bookHash,
  onClose,
  onSaved,
  onRemoved,
}: WordPanelProps) {
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [syncNote, setSyncNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSavedWord(language, word).then((stored) => {
      if (!cancelled && stored) setSavedEntry(stored);
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
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSyncNote(false);
    try {
      const entry = await saveWord({
        form: word,
        lemma: primary?.lemma,
        pos: primary?.pos,
        meaning: primary?.senses[0]?.definition,
        language,
        context,
        bookHash,
      });
      setSavedEntry(entry);
      onSaved(entry);
      // La palabra ya está a salvo localmente; si el envío falla lo
      // decimos sin fingir sincronización.
      const pushed = await pushWordsToServer([entry]);
      if (!pushed) setSyncNote(true);
    } catch {
      setSaveError("No se pudo guardar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const tombstone = await removeSavedWord(wordKey(language, word));
      if (tombstone) {
        setSavedEntry(null);
        onRemoved?.(tombstone);
        void pushWordsToServer([tombstone]);
      }
    } catch {
      setSaveError("No se pudo quitar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet label={`Palabra ${word}`} onClose={onClose} side="right">
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

      {context ? <ContextQuote context={context} word={word} /> : null}

      {lookup.kind === "loading" ? <p className="meta">Buscando en el catálogo…</p> : null}
      {lookup.kind === "enriching" ? <p className="meta">Consultando la ficha…</p> : null}
      {lookup.kind === "error" ? (
        <>
          <p role="alert" className="status">
            {lookup.message}
          </p>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => {
              setLookup({ kind: "loading" });
              void lookupWord(word, language).then((result) => {
                if (!result.ok) setLookup({ kind: "error", message: result.error });
                else if (!result.found) setLookup({ kind: "notFound" });
                else setLookup({ kind: "found", entries: result.entries });
              });
            }}
          >
            Intentar de nuevo
          </button>
        </>
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
        {savedEntry ? (
          <>
            <button type="button" className="btn btn--primary" disabled>
              En tu cuaderno
            </button>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => void remove()}
              disabled={saving}
            >
              Quitar
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Guardar palabra"}
          </button>
        )}
      </div>
      {saveError ? (
        <p role="alert" className="status">
          {saveError}
        </p>
      ) : null}
      {syncNote ? (
        <p className="meta">Se guardó en este dispositivo; se sincroniza al volver la conexión.</p>
      ) : null}
    </Sheet>
  );
}
