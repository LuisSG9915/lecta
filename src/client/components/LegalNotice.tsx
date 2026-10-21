import { useState } from "react";
import Dialog from "./Dialog";

export interface LegalNoticeProps {
  initialTab?: "privacy" | "terms";
  onClose: () => void;
}

export default function LegalNotice({
  initialTab = "privacy",
  onClose,
}: LegalNoticeProps) {
  const [tab, setTab] = useState<"privacy" | "terms">(initialTab);

  return (
    <Dialog label="Información Legal" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">
          {tab === "privacy" ? "Aviso de Privacidad" : "Términos de Uso"}
        </strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      <div className="auth-tabs" role="tablist" style={{ marginTop: "var(--s-2)" }}>
        <button
          type="button"
          role="tab"
          className="auth-tab-btn"
          aria-selected={tab === "privacy"}
          onClick={() => setTab("privacy")}
        >
          Privacidad
        </button>
        <button
          type="button"
          role="tab"
          className="auth-tab-btn"
          aria-selected={tab === "terms"}
          onClick={() => setTab("terms")}
        >
          Términos
        </button>
      </div>

      <div
        className="legal-content"
        style={{
          padding: "var(--s-4) 0",
          maxHeight: "65vh",
          overflowY: "auto",
          fontSize: "var(--fs-sm)",
          lineHeight: "1.6",
        }}
      >
        {tab === "privacy" ? (
          <article>
            <h3 className="eyebrow" style={{ marginBottom: "var(--s-2)" }}>
              Privacidad y control de tus datos
            </h3>
            <p>
              En Lecta consideramos que la lectura es un acto íntimo. Nuestra arquitectura
              es <strong>local primero (local-first)</strong>: tus libros, anotaciones,
              posiciones de lectura y cuaderno de vocabulario se almacenan directamente en la
              base de datos local de tu navegador (IndexedDB).
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Sincronización opcional</h4>
            <p>
              Si decides registrarte con una cuenta, los datos de lectura se sincronizan con
              nuestros servidores para permitirte continuar en otros dispositivos. Puedes
              descargar una copia completa de tus datos en formato JSON o eliminar tu cuenta
              en cualquier momento desde los ajustes de perfil.
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Consultas de Inteligencia Artificial</h4>
            <p>
              Si activas la ayuda de inteligencia artificial para definiciones o explicaciones en contexto,
              únicamente se envía al modelo la palabra consultada y su oración inmediata (hasta 500 caracteres).
              El contenido completo del libro, tus credenciales y tu identidad nunca se transmiten al proveedor del modelo.
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Sin rastreadores ni anuncios</h4>
            <p>
              Lecta no contiene rastreadores de publicidad de terceros, píxeles de seguimiento ni comercializa
              con la actividad de los lectores.
            </p>
          </article>
        ) : (
          <article>
            <h3 className="eyebrow" style={{ marginBottom: "var(--s-2)" }}>
              Términos de servicio y licencias
            </h3>
            <p>
              Lecta es una plataforma diseñada para el fomento de la lectura profunda, el estudio de vocabulario
              y la concentración.
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Propiedad de tus lecturas</h4>
            <p>
              Tú conservas la titularidad y los derechos sobre cualquier archivo EPUB que cargues en tu
              estantería. Eres responsable de contar con los derechos o autorizaciones pertinentes para los libros
              que decidas almacenar o sincronizar.
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Datos léxicos y fuentes abiertas</h4>
            <p>
              El catálogo de definiciones y lemas utiliza datos de fuentes libres: simplemma (MIT),
              Wikcionario en español vía kaikki.org (CC BY-SA 4.0 / GFDL) y wordfreq (CC BY-SA 4.0).
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Disponibilidad del servicio</h4>
            <p>
              El servicio se ofrece tal como está. Dado el diseño local-first, tus datos permanecen disponibles en
              este dispositivo aun sin conexión a Internet. Se recomienda descargar respaldos periódicos mediante la
              herramienta de exportación.
            </p>
          </article>
        )}
      </div>
    </Dialog>
  );
}
