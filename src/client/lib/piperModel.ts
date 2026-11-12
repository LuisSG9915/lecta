// Configuración del modelo neural Piper VITS para español mexicano (es_MX).
// Hermana de `kittenModel.ts`: mismas reglas — la ruta se sirve con
// `Cache-Control: immutable` un año, así que el nombre lleva versión y la
// caché también. El cliente verifica SHA-256 antes de cachear.
//
// El binario vive en el bucket R2 junto al de Kitten (`/models/…`), se
// descarga una sola vez y funciona sin conexión.

export const PIPER_CACHE_NAME = "lecta-tts-models-v1";
export const PIPER_MODEL_URL = "/models/es_MX-claude-high-v1.onnx";
/** Config del modelo (phoneme_id_map, escalas, sample rate): ~5 KB. */
export const PIPER_CONFIG_URL = `${PIPER_MODEL_URL}.json`;
/** Voz única del catálogo Piper es_MX (claude-high, un solo speaker). */
export const PIPER_VOICE_ID = "es_MX-claude-high";
/** SHA-256 del binario publicado (rhasspy/piper-voices es/es_MX/claude/high). */
export const PIPER_MODEL_SHA256 = "3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0";
export const PIPER_MODEL_BYTES = 63_122_309;
