# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Lector bilingüe español/inglés: lee libros EPUB por gusto en las dos lenguas y
quiere ampliar vocabulario mientras lee, tanto en su lengua materna como en la
segunda. Lee sobre todo en el celular (PWA en vertical), también en escritorio
y en un Kindle e-ink. Parte de su lectura puede ocurrir fuera de la app (libro
físico u otro servicio).

## Product Purpose

Lecta es un lector de EPUB con aprendizaje de vocabulario integrado. La persona
lee; al tocar una palabra ve su significado, la guarda en el Cuaderno con la
frase del libro y la repasa después con repetición espaciada. Antes de cada
capítulo la app predice qué palabras probablemente no conoce y ofrece
prepararlas.

Éxito: la persona sigue leyendo sin interrupciones y su vocabulario crece como
consecuencia de leer, no de estudiar aparte.

## Positioning

- **El vocabulario nace del libro.** Cada palabra se guarda leyendo, con su
  frase original, y el repaso enseña antes de examinar: nunca se pregunta una
  palabra que la persona no ha visto presentada.
- **Inteligencia invisible.** La predicción de palabras difíciles y la
  programación del repaso trabajan sin jerga ni pasos previos: tocar un libro
  abre el lector directo y las acciones clave son de un toque.
- **Lee donde sea.** El mismo progreso (posición exacta dentro del párrafo,
  Cuaderno, repasos) viaja entre celular, escritorio y Kindle e-ink.

## Operating Context

- Sesiones de lectura largas en celular, a menudo sin conexión; la app
  funciona local primero (IndexedDB) y sin cuenta. La cuenta solo añade
  sincronización entre dispositivos.
- Vistas principales: Biblioteca (estantería), Lector, ficha de palabra,
  Cuaderno (Herbario, Aprender, Repasar, modos libres), Tu recorrido, Explora
  (catálogo), Tú (cuenta y ajustes).
- Portal Kindle `/k`: HTML servido por el servidor para e-ink, funciona solo
  con enlaces y formularios; vinculación por código de 4 letras.
- Lectura en voz alta (TTS) con voces del sistema y una voz neural offline
  opcional descargable.
- Diccionario local descargable por idioma (es, en) que se instala solo al
  abrir un libro; la IA es opcional y requiere sesión.

## Capabilities and Constraints

- Interfaz en español; libros en español e inglés. Las glosas de palabras
  inglesas están en español.
- Reglas de producto vigentes:
  - Tocar un libro abre el lector de inmediato; nada a pantalla completa se
    interpone.
  - Ninguna función psicométrica muestra jerga técnica ni bloquea la lectura.
  - En el lector existe un solo dock inferior, que cambia entre lectura y audio.
  - Nunca se muestran hashes, ids ni nombres de archivo técnicos como texto.
  - El Cuaderno solo examina palabras vencidas que ya fueron presentadas; con
    vencidas, «Repasar» es la acción principal.
  - En la ficha de palabra el significado va primero; la explicación en
    contexto aparece solo al pedirla, y el mismo texto no se pinta dos veces.
- Temas `papel` y `noche`: todo componente compartido debe funcionar en ambos.
- Presupuesto de peso del cliente: 215 kB gzip en el bundle principal, con
  poco margen.
- Escritorio a partir de `64rem`; el orden del contenido en móvil es el orden
  lógico de referencia.
- Stack existente: React 19 + Vite (SPA/PWA) sobre Cloudflare Workers.
- Sin decidir: modo acompañante para quien lee fuera de la app
  (`docs/diseno-acompanante-lectura.md`, propuesta sin implementar).

## Brand Commitments

- **Gato compañero**: parte fija de la identidad; acompaña la lectura y la
  práctica con poses, frases, puntos y logros.
- **Metáfora editorial**: el producto habla con vocabulario de papel y tinta:
  Cuaderno, Herbario, Sendero de Tinta, estantería, temas papel y noche.
- Nombre actual: Lecta. Lema actual: «tu cuaderno de lectura» (no declarado
  como obligatorio).

## Evidence on Hand

- Producción: `https://lecta.luis-sg9915.workers.dev`.
- Documentación de producto y diseño en `docs/` (`sistema-lecta.md`,
  `auditoria-ux-2026-10-24.md`, `arte-companero.md`,
  `estrategia-aprendizaje-2026-10-24.md`, `plan-simplificacion-cuaderno.md`).
- Capturas de la ficha de palabra en `artifacts/ux-word-card/`.
- Iconos de la app en `public/icons/`; tipografías auto-hospedadas del portal
  Kindle en `public/fonts/`.
- No hay testimonios, cifras de usuarios, prensa ni precios: no inventarlos.

## Product Principles

1. **La lectura manda.** Nada interrumpe ni retrasa el acto de leer; el
   aprendizaje se acomoda alrededor.
2. **Enseñar antes de examinar.** Una palabra se presenta con su contexto antes
   de pedirle algo a la persona.
3. **La inteligencia no se ve.** Los modelos trabajan detrás; la persona ve
   palabras sencillas y acciones de un toque.
4. **Un solo progreso en todos lados.** Lo leído y lo aprendido es lo mismo en
   cualquier dispositivo, con o sin conexión.
5. **Nada se repite ni sobra.** Un control por función, un texto por idea.

## Accessibility & Inclusion

- Contraste verificado en ambos temas; las pruebas automáticas de
  accesibilidad (axe) cubren cuatro vistas.
- El movimiento se apaga por completo con `prefers-reduced-motion`.
- Opciones de lectura para dislexia y alta legibilidad en el Kindle
  (OpenDyslexic, Atkinson).
- Objetivos táctiles de al menos 44 px en e-ink.
