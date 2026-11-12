// Bienvenida sin sesión (docs/designs/2026-11-12-planes-y-landing.md): la
// cuenta es obligatoria para entrar. Muestra el gato elegido en el landing
// (o el naranja por defecto), los formularios de acceso y, sin red, el aviso
// de que la primera vez hace falta conexión. Se carga con React.lazy.
import { Companion } from "./Companion";
import AuthForms from "./AuthForms";
import { pendingStarterCoat } from "../lib/account-plan";
import { COMPANION_COATS } from "../../shared/companion-data";

export interface WelcomeProps {
  /** Token de restablecer contraseña (?token=). */
  resetToken?: string;
  onResetDone?: () => void;
  offline: boolean;
  /** Aviso del enlace (vencido, cuenta eliminada…). */
  notice?: string;
  onShowLegal?: (kind: "privacy" | "terms") => void;
}

export default function Welcome({
  resetToken,
  onResetDone,
  offline,
  notice,
  onShowLegal,
}: WelcomeProps) {
  const coat = pendingStarterCoat() ?? "ginger";
  const coatDef = COMPANION_COATS[coat];

  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <section className="welcome-card">
        <div className="welcome-cat" aria-hidden="true">
          <Companion stage={0} mood="awake" accessories={[]} coatId={coat} decorative still />
        </div>
        <p className="eyebrow">Lecta</p>
        <h1 id="welcome-title" className="welcome-title">
          Lee. Las palabras se quedan.
        </h1>
        <p className="welcome-lede">
          {coatDef.name} te acompaña mientras lees. Crea tu cuenta gratis o entra para
          seguir donde te quedaste.
        </p>
        {notice ? (
          <p role="status" className="status">
            {notice}
          </p>
        ) : null}
        {offline ? (
          <p role="status" className="welcome-offline" data-testid="welcome-offline">
            Para crear tu cuenta necesitas conexión, solo esta vez. Después Lecta funciona sin
            internet.
          </p>
        ) : (
          <AuthForms
            initialMode={resetToken ? "reset" : "signup"}
            resetToken={resetToken}
            onSuccess={() => undefined}
            onResetDone={onResetDone}
            onShowLegal={onShowLegal}
          />
        )}
      </section>
    </main>
  );
}
