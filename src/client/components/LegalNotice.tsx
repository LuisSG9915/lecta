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
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>
              Responsable del tratamiento y cumplimiento LFPDPPP
            </h4>
            <p>
              En cumplimiento con la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), se informa la identidad y domicilio del Responsable del Tratamiento:
            </p>
            <p style={{ fontStyle: "italic", background: "var(--c-surface-2, rgba(0,0,0,0.05))", padding: "var(--s-2)", borderRadius: "var(--r-sm)" }}>
              [PENDIENTE DE REVISIÓN POR TITULAR: Nombre/Razón Social, Domicilio y Correo Legal]
            </p>
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>Derechos ARCO y procedimiento de revocación</h4>
            <p>
              Conforme a la LFPDPPP, tienes derecho a ejercer tus derechos de Acceso, Rectificación, Cancelación y Oposición (derechos ARCO), así como revocar en cualquier momento el consentimiento otorgado para el tratamiento de tus datos personales.
            </p>
            <p>
              Puedes ejercer estos derechos enviando una solicitud al correo de contacto legal o directamente desde los controles de la aplicación mediante la descarga íntegra de tu respaldo en formato JSON y el borrado irreversible de tu cuenta (el cual ejecuta una purga en cascada de tus palabras, posiciones y archivos en la nube). Las solicitudes dirigidas al Responsable serán atendidas en los términos y plazos fijados por la LFPDPPP.
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
            <h4 style={{ margin: "var(--s-3) 0 var(--s-1)" }}>
              Datos léxicos, licencias abiertas y cumplimiento ODbL 1.0
            </h4>
            <p>
              Lecta incluye datos léxicos derivados para lematización y análisis de vocabulario. En estricto cumplimiento con las licencias de las fuentes originales:
            </p>
            <ul style={{ paddingLeft: "var(--s-4)", display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
              <li>
                <strong>Tabla derivada forma → lema (ODbL 1.0):</strong> Contiene información de «Lemmatization lists» de Michal Měchura, disponible bajo la Open Database License (ODbL) 1.0. La tabla derivada <code>forma → lema</code> está licenciada bajo ODbL 1.0. En cumplimiento de las cláusulas §4.3 y §4.6 de la licencia, la base de datos derivada está disponible para su libre descarga pública en <a href="/lexicon/forms-es.tsv.gz" download>forms-es.tsv.gz</a> (665 732 pares), junto con su procedencia, licencia y suma de verificación en <a href="/lexicon/README.md">/lexicon/README.md</a>.
              </li>
              <li>
                <strong>Frecuencias zipf (CC BY-SA 4.0):</strong> Derivadas de <em>wordfreq</em> de Robyn Speer (CC BY-SA 4.0; incluye corpus Google Books Ngrams, Wikipedia, ParaCrawl, OpenSubtitles y listas SUBTLEX de Marc Brysbaert et al.). La tabla derivada <a href="/lexicon/lemmas-freq-es.tsv.gz" download>lemmas-freq-es.tsv.gz</a> se publica bajo CC BY-SA 4.0.
              </li>
              <li>
                <strong>Acepciones y definiciones (CC BY-SA 4.0 + GFDL):</strong> Las definiciones estructuradas provienen del Wikcionario en español vía <a href="https://kaikki.org" target="_blank" rel="noopener noreferrer">kaikki.org</a> bajo licencias libres CC BY-SA 4.0 y GFDL.
              </li>
              <li>
                <strong>Componentes adicionales:</strong> Simplemma (MIT, © Adrien Barbaresi), FreeLing (LGPLLR), spaCy lookups-data (MIT), UniMorph (CC BY-SA 3.0) y Wikinflection (CC BY 4.0).
              </li>
            </ul>
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
