// Hoja «Adjunta tu archivo o pasa a Lecta+» (docs/designs/2026-11-12-planes-y-landing.md):
// un libro propio de una cuenta free está en la estantería (metadatos) pero
// su archivo no viajó. Se adjunta el mismo EPUB y se empareja por sha256.
// Se carga con React.lazy desde App: no pesa en el arranque.
import { useState } from "react";
import Sheet from "./Sheet";
import { matchAttachedEpub, EPUB_FORMAT_ERROR, EPUB_SIZE_ERROR } from "../lib/epub-intake";
import { captureDbScope, saveBook, updateBookMeta } from "../lib/idb";
import { readBookMeta } from "../lib/cover";
import type { ShelfItem } from "./Shelf";
import PlanNote from "./PlanNote";
import { useUserPlan } from "../lib/account-plan";

export const ATTACH_MISMATCH_MESSAGE =
  "Este archivo es distinto al que abriste originalmente. Adjunta el mismo archivo EPUB o pasa a Lecta+ para sincronizar tus libros automáticamente.";

export default function AttachBookSheet({
  item,
  onClose,
  onAttached,
}: {
  item: ShelfItem;
  onClose: () => void;
  /** El archivo coincidió y quedó guardado: abrir el libro. */
  onAttached: (item: ShelfItem) => void | Promise<void>;
  /** Reservado: la invitación a Lecta+ ya vive en PlanNote. */
  onOpenCarne?: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const userPlan = useUserPlan();
  const isFree = userPlan?.plan === "free";

  const attach = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const result = await matchAttachedEpub(file, item.hash);
      if (!result.ok) {
        setError(
          result.reason === "mismatch"
            ? ATTACH_MISMATCH_MESSAGE
            : result.reason === "size"
              ? EPUB_SIZE_ERROR
              : EPUB_FORMAT_ERROR,
        );
        return;
      }
      const scope = captureDbScope();
      await saveBook(
        {
          hash: item.hash,
          name: file.name,
          data: file,
          title: item.title,
          author: item.author,
          language: item.language,
          addedAt: Date.now(),
        },
        scope,
      );
      const meta = await readBookMeta(file).catch(() => null);
      if (meta) {
        await updateBookMeta(
          item.hash,
          {
            title: meta.title || item.title,
            author: meta.author || item.author,
            language: meta.language || item.language,
            sectionCount: meta.sectionCount,
            cover: meta.cover ?? undefined,
            genre: meta.genre,
            metaVersion: 1,
          },
          scope,
        ).catch(() => null);
      }
      await onAttached({ ...item, remoteOnly: undefined, name: file.name });
    } catch {
      setError("No se pudo guardar el archivo en este dispositivo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label="Adjunta tu archivo" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">{isFree ? "Adjunta tu archivo o pasa a Lecta+" : "Adjunta tu archivo"}</strong>
      </div>
      <p className="meta">
        Tu posición y tus palabras de este libro ya están aquí. El archivo EPUB se quedó en el
        dispositivo donde lo agregaste: adjunta el mismo archivo para seguir leyendo.
      </p>
      {isFree ? (
        <PlanNote
          feature="cloud"
          title="Biblioteca en la nube"
          detail="Con Lecta+ tus libros viajan solos entre tus aparatos, sin adjuntar nada."
        />
      ) : null}
      <label className="btn btn--primary attach-book-input">
        {busy ? "Comprobando…" : "Adjuntar el archivo EPUB"}
        <input
          type="file"
          accept=".epub,application/epub+zip"
          disabled={busy}
          data-autofocus
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void attach(file);
          }}
        />
      </label>
      {error ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
