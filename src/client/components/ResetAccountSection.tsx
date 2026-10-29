import { useState } from "react";
import { startFromScratch } from "../lib/account-reset";

export interface ResetAccountSectionProps {
  userId: string;
  authToken?: string;
  onResetSuccess?: () => void;
}

export function ResetAccountSection({
  userId,
  authToken,
  onResetSuccess,
}: ResetAccountSectionProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const CONFIRM_KEYWORD = "EMPEZAR DE CERO";
  const canConfirm = confirmText.trim().toUpperCase() === CONFIRM_KEYWORD && !isLoading;

  const handleReset = async () => {
    if (!canConfirm) return;
    setIsLoading(true);
    setError(null);

    try {
      await startFromScratch(userId, authToken);
      setIsConfirmOpen(false);
      setConfirmText("");
      if (onResetSuccess) {
        onResetSuccess();
      } else {
        // Recargar hacia la vista inicial para reabrir IndexedDB limpia en memoria
        window.location.assign("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al reiniciar los datos.");
      setIsLoading(false);
    }
  };

  return (
    <div
      className="reset-account-box rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
      style={{
        border: "1px solid var(--warning, #d97706)",
        background: "var(--warning-wash, rgba(217, 119, 6, 0.08))",
        borderRadius: "var(--radius-m, 12px)",
        padding: "var(--s-4, 1rem)",
        marginTop: "var(--s-4, 1rem)",
      }}
    >
      <div
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--s-2, 0.5rem)",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3
            className="text-base font-semibold text-amber-900 dark:text-amber-200"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-base, 1rem)",
              fontWeight: 600,
              color: "var(--amber, #b45309)",
              margin: "0 0 var(--s-1, 0.25rem) 0",
            }}
          >
            Empezar de cero
          </h3>
          <p
            className="text-sm text-neutral-600 dark:text-neutral-400"
            style={{
              color: "var(--ink-soft)",
              fontSize: "var(--fs-sm, 0.85rem)",
              margin: 0,
              lineHeight: 1.45,
            }}
          >
            Borra todo tu historial de lectura, libros subidos y palabras guardadas sin eliminar tu cuenta.
          </p>
        </div>

        {!isConfirmOpen && (
          <button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            className="shrink-0 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3.5 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-200"
            style={{
              alignSelf: "flex-start",
              borderRadius: "var(--radius-s, 8px)",
              border: "1px solid var(--warning, #d97706)",
              background: "transparent",
              padding: "var(--s-2, 0.5rem) var(--s-3, 0.75rem)",
              fontSize: "var(--fs-sm, 0.85rem)",
              fontWeight: 500,
              color: "var(--amber, #b45309)",
              cursor: "pointer",
              marginTop: "var(--s-2, 0.5rem)",
            }}
          >
            Empezar de cero…
          </button>
        )}
      </div>

      {isConfirmOpen && (
        <div
          className="confirm-zone mt-4 space-y-3 border-t border-amber-500/20 pt-4"
          style={{
            marginTop: "var(--s-3, 0.75rem)",
            paddingTop: "var(--s-3, 0.75rem)",
            borderTop: "1px solid rgba(217, 119, 6, 0.2)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-2, 0.5rem)",
          }}
        >
          <p
            className="text-xs text-neutral-600 dark:text-neutral-300"
            style={{
              fontSize: "var(--fs-xs, 0.75rem)",
              color: "var(--ink-soft)",
              margin: 0,
            }}
          >
            Esta acción eliminará permanentemente tus palabras, repasos SRS, anotaciones y libros sincronizados en todos tus dispositivos. Escribe{" "}
            <strong
              className="font-mono text-amber-700 dark:text-amber-300"
              style={{
                fontFamily: "monospace",
                color: "var(--amber, #b45309)",
                fontWeight: 700,
              }}
            >
              {CONFIRM_KEYWORD}
            </strong>{" "}
            para confirmar:
          </p>

          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_KEYWORD}
            disabled={isLoading}
            aria-label="Confirmar reinicio de cuenta"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            style={{
              width: "100%",
              borderRadius: "var(--radius-s, 8px)",
              border: "var(--border, 1px solid var(--rule))",
              background: "var(--paper-raised, #ffffff)",
              color: "var(--ink)",
              padding: "var(--s-2, 0.5rem) var(--s-3, 0.75rem)",
              fontSize: "var(--fs-sm, 0.85rem)",
              fontFamily: "monospace",
            }}
          />

          {error && (
            <p
              role="alert"
              className="text-xs font-medium text-red-600 dark:text-red-400"
              style={{
                fontSize: "var(--fs-xs, 0.75rem)",
                fontWeight: 500,
                color: "var(--vermilion, #dc2626)",
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          <div
            className="flex items-center justify-end gap-2"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "var(--s-2, 0.5rem)",
              marginTop: "var(--s-2, 0.5rem)",
            }}
          >
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setIsConfirmOpen(false);
                setConfirmText("");
                setError(null);
              }}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
              style={{
                borderRadius: "var(--radius-s, 8px)",
                border: "none",
                background: "transparent",
                padding: "var(--s-2, 0.5rem) var(--s-3, 0.75rem)",
                fontSize: "var(--fs-sm, 0.85rem)",
                color: "var(--ink-soft)",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleReset}
              className="btn-reset-confirm rounded-lg bg-amber-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-40"
              style={{
                borderRadius: "var(--radius-s, 8px)",
                border: "1px solid var(--amber, #d97706)",
                background: canConfirm ? "var(--amber, #d97706)" : "var(--paper-sunken)",
                color: canConfirm ? "#ffffff" : "var(--ink-faint)",
                padding: "var(--s-2, 0.5rem) var(--s-3, 0.75rem)",
                fontSize: "var(--fs-sm, 0.85rem)",
                fontWeight: 500,
                cursor: canConfirm ? "pointer" : "not-allowed",
                opacity: canConfirm ? 1 : 0.5,
                transition: "background var(--dur-1) var(--ease-out)",
              }}
            >
              {isLoading ? "Borrando datos…" : "Confirmar reinicio"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
