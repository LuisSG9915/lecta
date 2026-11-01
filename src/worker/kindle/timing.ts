// Temporizador por etapa del portal Kindle. Cada mark() acumula el
// tiempo transcurrido desde la marca anterior bajo ese nombre, y
// header() lo serializa como Server-Timing (duraciones en ms con un
// decimal). El total se mide desde la creación del temporizador.

export type KindleTimer = {
  mark(name: string): void;
  header(): string;
};

export function createTimer(): KindleTimer {
  const marks = new Map<string, number>();
  const start = performance.now();
  let last = start;
  return {
    mark(name: string) {
      const t = performance.now();
      marks.set(name, (marks.get(name) ?? 0) + (t - last));
      last = t;
    },
    header() {
      const parts: string[] = [];
      for (const [name, dur] of marks) {
        parts.push(`${name};dur=${dur.toFixed(1)}`);
      }
      parts.push(`total;dur=${(performance.now() - start).toFixed(1)}`);
      return parts.join(", ");
    },
  };
}
