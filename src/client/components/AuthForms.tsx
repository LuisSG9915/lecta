// Formularios de acceso (entrar, crear cuenta, enlace por correo, recuperar y
// restablecer contraseña). Los usan la hoja de «Tú» (Account) y la bienvenida
// (Welcome) — docs/designs/2026-11-12-planes-y-landing.md.
import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";
import TurnstileBox, { turnstileSiteKey } from "./TurnstileBox";

export type AuthMode = "signin" | "signup" | "magic" | "forgot" | "reset";

export function translateAuthError(message?: string): string {
  if (!message) return "No se pudo completar la acción.";
  const lower = message.toLowerCase();
  if (lower.includes("invalid email or password") || lower.includes("invalid_email_or_password")) {
    return "Correo o contraseña incorrectos.";
  }
  if (lower.includes("invalid email") || lower.includes("invalid_email")) {
    return "El correo electrónico no tiene un formato válido.";
  }
  if (lower.includes("user not found") || lower.includes("user_not_found")) {
    return "No se encontró ningún usuario con este correo.";
  }
  if (lower.includes("password is too short") || lower.includes("password_too_short")) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }
  if (lower.includes("password is too long") || lower.includes("password_too_long")) {
    return "La contraseña es demasiado larga.";
  }
  if (lower.includes("invalid token") || lower.includes("invalid_token")) {
    return "El enlace ya venció o no es válido. Pide uno nuevo.";
  }
  if (
    lower.includes("captcha") ||
    lower.includes("missing_response") ||
    lower.includes("verification_failed")
  ) {
    return "No pudimos comprobar que eres una persona. Espera un momento y vuelve a intentarlo.";
  }
  if (lower.includes("user already exists") || lower.includes("user_already_exists")) {
    return "Ya existe una cuenta con este correo. Inicia sesión o pide un enlace.";
  }
  return message;
}

export interface AuthFormsProps {
  /** Modo con que abre (el token de restablecer fuerza "reset"). */
  initialMode?: AuthMode;
  resetToken?: string;
  /** Acceso logrado: quien monta cierra su hoja o deja pasar a la app. */
  onSuccess: () => void;
  onResetDone?: () => void;
  /** Si existe, se pinta el botón «Cerrar». */
  onClose?: () => void;
  /** Si existe, se pinta el enlace al aviso de privacidad. */
  onShowLegal?: (kind: "privacy" | "terms") => void;
}

export default function AuthForms({
  initialMode = "signin",
  resetToken,
  onSuccess,
  onResetDone,
  onClose,
  onShowLegal,
}: AuthFormsProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>(resetToken ? "reset" : initialMode);
  // Turnstile (registro y enlace por correo): cada token sirve una vez.
  const siteKey = turnstileSiteKey();
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRound, setCaptchaRound] = useState(0);
  const captchaOptions = () => {
    const token = captchaToken;
    setCaptchaToken("");
    setCaptchaRound((n) => n + 1);
    return token ? { headers: { "x-captcha-response": token } } : undefined;
  };
  const captchaPending = () => {
    if (!siteKey || captchaToken) return false;
    setError("Un momento: estamos comprobando que eres una persona.");
    return true;
  };

  const run = async (
    action: () => Promise<{ error?: { message?: string } | null } | undefined>,
  ) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.error) setError(translateAuthError(result.error.message));
      return result;
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo.");
      return;
    }
    if (!password) {
      setError("Por favor, introduce tu contraseña.");
      return;
    }
    void run(async () => {
      const result = await authClient.signIn.email({ email: cleanEmail, password });
      if (!result?.error) {
        onSuccess();
      }
      return result;
    });
  };

  const signUp = (event?: FormEvent) => {
    event?.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo para registrarte.");
      return;
    }
    if (!password || password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    const name = cleanEmail.split("@")[0] || "Lector";
    if (captchaPending()) return;
    const fetchOptions = captchaOptions();
    void run(async () => {
      const result = await authClient.signUp.email({
        email: cleanEmail,
        password,
        name,
        fetchOptions,
      });
      if (!result?.error) {
        onSuccess();
      }
      return result;
    });
  };

  const sendMagicLink = () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo para enviarte el enlace.");
      return;
    }
    if (captchaPending()) return;
    const fetchOptions = captchaOptions();
    void run(async () => {
      const result = await authClient.signIn.magicLink({
        email: cleanEmail,
        callbackURL: "/",
        fetchOptions,
      });
      if (!result?.error)
        setMessage(
          "Te enviamos un enlace para entrar. Si es tu primera vez, al abrirlo creamos tu cuenta.",
        );
      return result;
    });
  };

  const sendResetLink = () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo para enviarte el enlace de restablecimiento.");
      return;
    }
    void run(async () => {
      const result = await authClient.requestPasswordReset({ email: cleanEmail, redirectTo: "/" });
      if (!result?.error)
        setMessage(
          "Si el correo está registrado, enviamos un enlace para restablecer la contraseña.",
        );
      return result;
    });
  };

  const resetPassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    void run(async () => {
      const result = await authClient.resetPassword({ newPassword, token: resetToken ?? "" });
      if (!result?.error) {
        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail) {
          const loginResult = await authClient.signIn.email({
            email: cleanEmail,
            password: newPassword,
          });
          if (!loginResult?.error) {
            onSuccess();
            return loginResult;
          }
        }
        setMessage("Contraseña actualizada. Ya puedes entrar con ella.");
        setPassword(newPassword);
        setNewPassword("");
        onResetDone?.();
        onSuccess();
      }
      return result;
    });
  };

  return (
    <>
      <div className="sheet-head">
        <strong className="sheet-title">
          {authMode === "reset"
            ? "Restablecer contraseña"
            : authMode === "forgot"
              ? "Recuperar acceso"
              : authMode === "magic"
                ? "Enlace por correo"
                : authMode === "signup"
                  ? "Crear cuenta"
                  : "Iniciar sesión"}
        </strong>
        {onClose ? (
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Cerrar"
            data-autofocus
          >
            Cerrar
          </button>
        ) : null}
      </div>

      {authMode === "signin" || authMode === "signup" || authMode === "magic" ? (
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="auth-tab-btn"
            aria-selected={authMode === "signin"}
            onClick={() => {
              setError("");
              setMessage("");
              setAuthMode("signin");
            }}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            className="auth-tab-btn"
            aria-selected={authMode === "signup"}
            onClick={() => {
              setError("");
              setMessage("");
              setAuthMode("signup");
            }}
          >
            Crear cuenta
          </button>
          <button
            type="button"
            role="tab"
            className="auth-tab-btn"
            aria-selected={authMode === "magic"}
            onClick={() => {
              setError("");
              setMessage("");
              setAuthMode("magic");
            }}
          >
            Enlace por correo
          </button>
        </div>
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

      {authMode === "signin" ? (
        <form className="field" onSubmit={signInWithPassword}>
          <label htmlFor="modal-email">Correo</label>
          <input
            id="modal-email"
            type="email"
            required
            autoComplete="email"
            aria-invalid={error ? "true" : undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="modal-password">Contraseña</label>
          <input
            id="modal-password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            aria-invalid={error ? "true" : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ width: "100%" }}
            >
              Entrar
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("forgot");
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "signup" ? (
        <form className="field" onSubmit={signUp}>
          <label htmlFor="modal-signup-email">Correo</label>
          <input
            id="modal-signup-email"
            type="email"
            required
            autoComplete="email"
            aria-invalid={error ? "true" : undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="modal-signup-password">Contraseña</label>
          <input
            id="modal-signup-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            aria-invalid={error ? "true" : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="meta">Mínimo 8 caracteres.</span>
          {siteKey ? (
            <TurnstileBox siteKey={siteKey} resetKey={captchaRound} onToken={setCaptchaToken} />
          ) : null}
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ width: "100%" }}
            >
              Crear cuenta
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("signin");
              }}
            >
              ¿Ya tienes cuenta? Inicia sesión
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "magic" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            sendMagicLink();
          }}
        >
          <p className="meta">
            Acceso sin contraseña. Te enviaremos un enlace a tu correo: al abrirlo entras, y si es
            tu primera vez creamos tu cuenta. El enlace vence en 10 minutos.
          </p>
          <label htmlFor="modal-magic-email">Correo</label>
          <input
            id="modal-magic-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {siteKey ? (
            <TurnstileBox siteKey={siteKey} resetKey={captchaRound} onToken={setCaptchaToken} />
          ) : null}
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !email.trim()}
              style={{ width: "100%" }}
            >
              Enviar enlace de acceso
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "forgot" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            sendResetLink();
          }}
        >
          <p className="meta">
            Escribe tu correo y te enviaremos las instrucciones para restablecer tu contraseña.
          </p>
          <label htmlFor="modal-forgot-email">Correo</label>
          <input
            id="modal-forgot-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !email.trim()}
              style={{ width: "100%" }}
            >
              Enviar instrucciones
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("signin");
              }}
            >
              Volver a iniciar sesión
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "reset" ? (
        <form className="field" onSubmit={resetPassword}>
          <p className="meta">Introduce tu nueva contraseña (mínimo 8 caracteres).</p>
          <label htmlFor="modal-reset-password">Nueva contraseña</label>
          <input
            id="modal-reset-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            aria-invalid={error ? "true" : undefined}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ width: "100%" }}
            >
              Guardar contraseña
            </button>
          </div>
        </form>
      ) : null}
      {onShowLegal ? (
        <div style={{ marginTop: "var(--s-3)", textAlign: "center" }}>
          <button
            type="button"
            className="btn--quiet"
            style={{ fontSize: "var(--fs-xs)", color: "var(--ink-soft)" }}
            onClick={() => onShowLegal("privacy")}
          >
            Aviso de Privacidad y Términos de Uso
          </button>
        </div>
      ) : null}
    </>
  );
}
