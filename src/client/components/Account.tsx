import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";

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
    <div className="word-panel" role="dialog" aria-modal="true" aria-label="Tu cuenta">
      <div className="word-panel-header">
        <strong>Cuenta</strong>
        <button type="button" onClick={onClose} aria-label="Cerrar cuenta">
          Cerrar
        </button>
      </div>

      {isPending ? <p>Cargando…</p> : null}

      {!isPending && session?.user ? (
        <>
          <p>
            Sesión iniciada como <strong>{session.user.email}</strong>
          </p>
          <button type="button" disabled={busy} onClick={signOut}>
            Cerrar sesión
          </button>
        </>
      ) : null}

      {!isPending && !session?.user ? (
        <form onSubmit={signInWithPassword}>
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
          <div className="practice-modes">
            <button type="submit" disabled={busy}>
              Entrar
            </button>
            <button type="button" disabled={busy || !password} onClick={signUp}>
              Crear cuenta
            </button>
            <button type="button" disabled={busy || !email} onClick={sendMagicLink}>
              Enlace por correo
            </button>
          </div>
        </form>
      ) : null}

      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
