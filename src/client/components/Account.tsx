import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";
import { PENDING_DELETE_KEY } from "../lib/account-cleanup";
import { loadSessionValue } from "../lib/idb";
import { timeAgo } from "../lib/relative-time";
import Dialog from "./Dialog";

export { PENDING_DELETE_KEY };

type AccountProps = {
  onClose: () => void;
  resetToken?: string;
  onResetDone?: () => void;
};

export default function Account({ onClose, resetToken, onResetDone }: AccountProps) {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showChange, setShowChange] = useState(false);
  const [credentialInfo, setCredentialInfo] = useState<{
    userId: string;
    has: boolean;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  const userId = session?.user?.id;

  // Última sincronización del cuaderno y estado de conexión, para
  // decirle a la persona dónde están sus palabras sin adivinar.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadSessionValue("vocabLastSyncAt").then((raw) => {
      if (!cancelled) setLastSync(raw ? Number(raw) : null);
    });
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      cancelled = true;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetch("/api/auth/list-accounts", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : []))
      .then((list: unknown) => {
        if (cancelled) return;
        const accounts = Array.isArray(list) ? list : [];
        setCredentialInfo({
          userId,
          has: accounts.some(
            (account) => (account as { providerId?: string }).providerId === "credential",
          ),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const hasCredential =
    credentialInfo && credentialInfo.userId === userId ? credentialInfo.has : null;

  const run = async (action: () => Promise<{ error?: { message?: string } | null }>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.error) setError(result.error.message ?? "No se pudo completar la acción.");
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(() => authClient.signIn.email({ email, password }));
  };

  const signUp = () => {
    const name = email.split("@")[0] || "Lector";
    void run(() => authClient.signUp.email({ email, password, name }));
  };

  const sendMagicLink = () => {
    void run(async () => {
      const result = await authClient.signIn.magicLink({ email, callbackURL: "/" });
      if (!result?.error) setMessage("Si el correo está registrado, enviamos un enlace de acceso.");
      return result;
    });
  };

  const sendResetLink = () => {
    void run(async () => {
      const result = await authClient.requestPasswordReset({ email, redirectTo: "/" });
      if (!result?.error)
        setMessage("Si el correo está registrado, enviamos un enlace para restablecer la contraseña.");
      return result;
    });
  };

  const resetPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await authClient.resetPassword({ newPassword, token: resetToken ?? "" });
      if (!result?.error) {
        setMessage("Contraseña actualizada. Ya puedes entrar con ella.");
        setNewPassword("");
        onResetDone?.();
      }
      return result;
    });
  };

  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (!result?.error) {
        setMessage("Contraseña actualizada. Las demás sesiones se cerraron.");
        setCurrentPassword("");
        setNewPassword("");
        setShowChange(false);
      }
      return result;
    });
  };

  const sendSetPasswordLink = () => {
    void run(async () => {
      const result = await authClient.requestPasswordReset({
        email: session?.user?.email ?? "",
        redirectTo: "/",
      });
      if (!result?.error)
        setMessage("Te enviamos un correo para definir tu contraseña.");
      return result;
    });
  };

  const requestDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void run(async () => {
      // El correo confirma el borrado y redirige aquí: esa marca es la
      // única evidencia de que la cuenta se eliminó (la sesión se revoca).
      const result = await authClient.deleteUser({ callbackURL: "/?cuenta=eliminada" });
      if (!result?.error) {
        if (session?.user?.id) localStorage.setItem(PENDING_DELETE_KEY, session.user.id);
        setConfirmDelete(false);
        setMessage(
          "Te enviamos un correo para confirmar el borrado. Tu cuenta se elimina al abrir ese enlace.",
        );
      }
      return result;
    });
  };

  const signOut = () => {
    void run(async () => {
      const result = await authClient.signOut();
      if (result?.error) return result;
      onClose();
      return {};
    });
  };

  return (
    <Dialog label="Tu cuenta" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Cuenta</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar cuenta"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {isPending ? <p className="meta">Cargando…</p> : null}

      {!isPending && session?.user ? (
        <>
          <p>
            Sesión iniciada como <strong>{session.user.email}</strong>
          </p>
          <p className="meta">
            {!online
              ? "Sin conexión: el cuaderno se sincroniza al volver."
              : lastSync
                ? `Cuaderno sincronizado ${timeAgo(lastSync)}.`
                : "Este dispositivo aún no sincroniza tu cuaderno."}
          </p>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={signOut}>
              Cerrar sesión
            </button>
          </div>
          {hasCredential ? (
            showChange ? (
              <form className="field" onSubmit={changePassword}>
                <label htmlFor="current-password">Contraseña actual</label>
                <input
                  id="current-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <label htmlFor="new-password">Nueva contraseña</label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <div className="actions">
                  <button type="submit" className="btn" disabled={busy}>
                    Guardar
                  </button>
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={() => setShowChange(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="actions">
                <button
                  type="button"
                  className="btn--quiet"
                  disabled={busy}
                  onClick={() => setShowChange(true)}
                >
                  Cambiar contraseña
                </button>
              </div>
            )
          ) : hasCredential === false ? (
            <div className="actions">
              <button
                type="button"
                className="btn--quiet"
                disabled={busy}
                onClick={sendSetPasswordLink}
              >
                Definir contraseña por correo
              </button>
            </div>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="btn--quiet"
              disabled={busy}
              onClick={requestDelete}
            >
              {confirmDelete ? "¿Seguro? Borra cuenta, libros y vocabulario" : "Eliminar cuenta"}
            </button>
          </div>
        </>
      ) : null}

      {resetToken && !session?.user ? (
        <form className="field" onSubmit={resetPassword}>
          <label htmlFor="reset-password">Nueva contraseña</label>
          <input
            id="reset-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div className="actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Guardar contraseña
            </button>
          </div>
        </form>
      ) : null}

      {!resetToken && !isPending && !session?.user ? (
        <form className="field" onSubmit={signInWithPassword}>
          <label htmlFor="account-email">Correo</label>
          <input
            id="account-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="account-password">Contraseña</label>
          <input
            id="account-password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Entrar
            </button>
            <button type="button" className="btn" disabled={busy || !password} onClick={signUp}>
              Crear cuenta
            </button>
            <button
              type="button"
              className="btn--quiet"
              disabled={busy || !email}
              onClick={sendMagicLink}
            >
              Enlace por correo
            </button>
          </div>
          <button
            type="button"
            className="btn--quiet"
            disabled={busy || !email}
            onClick={sendResetLink}
          >
            Olvidé mi contraseña
          </button>
        </form>
      ) : null}

      {message ? (
        <p role="status" className="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
