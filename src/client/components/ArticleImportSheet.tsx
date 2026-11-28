import { useState, type FormEvent } from "react";
import Dialog from "./Dialog";
import { captureDbScope } from "../lib/idb";
import {
  ArticleImportError,
  buildArticleEpubFile,
  fetchExtractedArticle,
} from "../lib/article-import";

export interface ArticleImportMeta {
  title?: string;
  author?: string;
  language?: string;
  localOnly: true;
}

export interface ArticleImportSheetProps {
  initialUrl?: string | null;
  isPlus: boolean;
  planLoading?: boolean;
  onImported: (file: File, meta: ArticleImportMeta) => void;
  onClose: () => void;
}

export default function ArticleImportSheet({
  initialUrl,
  isPlus,
  planLoading = false,
  onImported,
  onClose,
}: ArticleImportSheetProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const scope = captureDbScope();
      const article = await fetchExtractedArticle(url.trim(), scope);
      const epubFile = await buildArticleEpubFile(article);
      onImported(epubFile, {
        title: article.title,
        author: article.author ?? article.sourceHost,
        language: article.language,
        localOnly: true,
      });
      onClose();
    } catch (err) {
      if (err instanceof ArticleImportError && err.code === "LECTA_PLUS_REQUIRED") {
        setError("Leer artículos por enlace es exclusivo de Lecta+.");
      } else {
        setError(err instanceof Error ? err.message : "No se pudo importar ese enlace.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog label="Leer artículo por enlace" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Leer artículo por enlace</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar importación de artículo"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {planLoading && !isPlus ? (
        <div className="shelf-options-section">
          <p className="meta">Comprobando tu plan…</p>
        </div>
      ) : !isPlus ? (
        <div className="shelf-options-section">
          <p className="meta">
            Trae ensayos, newsletters o artículos largos con Lecta+ (incluido durante tus 14 días de prueba) y léelos tocando cualquier palabra, con Herbario y voz neural.
          </p>
          <div style={{ display: "flex", gap: "var(--s-2)", marginTop: "var(--s-3)" }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("lecta:open-carne"));
                onClose();
              }}
            >
              Ver Lecta+
            </button>
            <button type="button" className="btn--quiet" onClick={onClose}>
              Ahora no
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="shelf-options-section">
            <label htmlFor="article-url-input" className="shelf-options-label">
              Enlace del artículo (HTTPS)
            </label>
            <input
              id="article-url-input"
              type="url"
              inputMode="url"
              className="shelf-community-search"
              style={{ width: "100%", marginTop: "var(--s-1)" }}
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              required
            />
            <p className="meta shelf-options-hint">
              Solo se guarda en este dispositivo; nunca se sube a la nube ni a la comunidad.
            </p>
            {error ? (
              <p className="meta" role="alert" style={{ color: "var(--vermilion)", marginTop: "var(--s-2)" }}>
                {error}
              </p>
            ) : null}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", marginTop: "var(--s-3)" }}>
            <button type="button" className="btn--quiet" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || !url.trim()}
            >
              {loading ? "Extrayendo…" : "Importar y leer"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
