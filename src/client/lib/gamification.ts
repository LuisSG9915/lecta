// Juego del Cuaderno: puntos de lectura (XP), niveles, logros, cofres
// y el cuidado del gato de biblioteca. Lógica pura — ninguna función
// toca almacenamiento ni DOM; el estado entra y sale serializado para
// que la capa de IO (game.ts) lo guarde donde convenga.
//
// Decisiones de diseño:
// - El XP es fraccional internamente (un minuto de lectura = 1); la
//   interfaz muestra enteros. Así un intervalo corto no se pierde.
// - El gato se cuida con cualquier actividad real (cada award toca
//   caredAt): nunca pide atención extra, solo refleja el uso.
// - Los cofres guardan su contenido al crearse (reward ya resuelto),
//   para que abrir sea solo revelar — sin sorteos en el momento.
//
// El módulo se movió a src/shared/gamification.ts para que el cliente
// y el Worker compartan la misma fuente de umbrales y fórmulas; aquí
// solo queda la reexportación para no tocar los imports existentes.

export * from "../../shared/gamification";
