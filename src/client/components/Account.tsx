import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";
import Dialog from "./Dialog";

type AccountProps = {
  onClose: () => void;
};

export default function Account({ onClose }: AccountProps) {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

  const signOut = () => {
    void run(async () => {
      await authClient.signOut();
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
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={signOut}>
              Cerrar sesión
            </button>
          </div>
        </>
      ) : null}

      {!isPending && !session?.user ? (
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
