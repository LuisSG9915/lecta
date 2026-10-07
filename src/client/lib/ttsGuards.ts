// Guardas de navegación y scroll programáticos del TTS. El lector
// reacciona a la navegación explícita (detener la voz) y a las
// señales de scroll (actividad); estos mecanismos distinguen los
// movimientos que hace el propio TTS de los que hace la persona.

// La navegación empieza síncrona (navigate marca el intent y dispara
// loadSection): leer el flag dentro de la llamada basta. Si algún
// camino se vuelve asíncrono, este flag debe crecer a token como el
// de scroll de abajo.
let ttsNav = false;

export const withTtsProgrammaticNav = (fn: () => void) => {
  ttsNav = true;
  try {
    fn();
  } finally {
    ttsNav = false;
  }
};
export const isTtsProgrammaticNav = () => ttsNav;

// El scroll es asíncrono: scrollIntoView agenda el movimiento y los
// eventos `scroll` llegan después, cuando un flag síncrono ya se
// habría liberado. Se marca una ventana corta en su lugar — cualquier
// scroll dentro de ella se trata como programático.
let ttsScrollUntil = 0;

// Marca una ventana de scroll programático (600 ms cubre el smooth
// scroll típico más el rebote de eventos que lo sigue).
export const noteTtsProgrammaticScroll = (ms = 600) => {
  ttsScrollUntil = Date.now() + ms;
};

export const isTtsProgrammaticScroll = () => Date.now() < ttsScrollUntil;
