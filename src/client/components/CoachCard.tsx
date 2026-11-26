// Coach semanal (Lecta+, F15), en «Tu recorrido». Chunk lazy: pide
// /api/coach/weekly (una nota por semana, hecha con cifras agregadas). En
// free (402) muestra el titular y la nota de Lecta+; sin sesión u otro
// fallo, nada.
import { useEffect, useState } from "react";
import { accountFetch } from "../lib/account-fetch";

type State = { kind: "loading" } | { kind: "coach"; text: string } | { kind: "none" };

export default function CoachCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    accountFetch("/api/coach/weekly")
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return setState({ kind: "none" });
        const body = (await res.json()) as { text?: string };
        setState(body.text ? { kind: "coach", text: body.text } : { kind: "none" });
      })
      .catch(() => alive && setState({ kind: "none" }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading" || state.kind === "none") return null;

  return (
    <section className="journey-coach" aria-label="Tu coach" data-testid="coach-card">
      <h3 className="journey-insight-title">Tu coach</h3>
      <p>{state.text}</p>
    </section>
  );
}
