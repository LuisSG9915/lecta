// Plan de estudio adaptativo (Lecta+, F16), en «Tu recorrido». Chunk lazy:
// pide /api/study-plan, que calcula en el servidor sin IA. En free (402)
// muestra el titular y la nota de Lecta+; sin sesión u otro fallo, nada.
// Pendiente: programar la notificación local en la ventana del hábito
// (`calculateHabitWindow(habitSamples)` + `scheduleHabitReminder`) — hoy
// esa programación vive en otro flujo y no se duplica aquí.
import { useEffect, useState } from "react";
import type { StudyPlan } from "../../shared/study-plan";
import { accountFetch } from "../lib/account-fetch";
import PlanNote from "./PlanNote";

type State = { kind: "loading" } | { kind: "free" } | { kind: "plan"; plan: StudyPlan } | { kind: "none" };

const DAY_NAMES = ["Hoy", "Mañana"];

function dayLabel(offset: number, now: Date): string {
  if (offset < DAY_NAMES.length) return DAY_NAMES[offset];
  const d = new Date(now.getTime() + offset * 86_400_000);
  return d.toLocaleDateString("es", { weekday: "short" });
}

export default function StudyPlanCard({
  books,
}: {
  books: { hash: string; name?: string; title?: string }[];
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    accountFetch("/api/study-plan")
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 402) return setState({ kind: "free" });
        if (!res.ok) return setState({ kind: "none" });
        setState({ kind: "plan", plan: (await res.json()) as StudyPlan });
      })
      .catch(() => alive && setState({ kind: "none" }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading" || state.kind === "none") return null;

  return (
    <section className="journey-section journey-study-plan" aria-label="Plan de estudio" data-testid="study-plan">
      <h3 className="journey-insight-title">Tu plan de la semana</h3>
      {state.kind === "free" ? (
        <PlanNote
          feature="study-plan"
          title="Plan de estudio con Lecta+"
          detail="Qué repasar cada día y cuánto leer, según tu ritmo real."
        />
      ) : state.plan.empty ? (
        <p className="meta">Aún no hay datos: lee un rato y guarda palabras, y aquí aparece tu plan.</p>
      ) : (
        <PlanBody plan={state.plan} books={books} />
      )}
    </section>
  );
}

function PlanBody({ plan, books }: { plan: StudyPlan; books: { hash: string; name?: string; title?: string }[] }) {
  const now = new Date();
  const book = plan.next ? books.find((b) => b.hash === plan.next?.bookHash) : undefined;
  const bookName = book?.title || book?.name;
  return (
    <>
      <p>
        Hoy: unos {plan.minutesToday} min ({plan.readingMinutes} de lectura
        {plan.days[0].reviews > 0 ? ` y ${plan.days[0].reviews} repasos` : ""}).
        {plan.habit === "default" ? " Aún no hay hábito medido; usamos una hora tranquila por la noche." : ""}
      </p>
      {plan.next && bookName ? (
        <p className="meta">Sigue con el capítulo {plan.next.sectionIndex + 1} de «{bookName}».</p>
      ) : null}
      <ul className="meta" aria-label="Repasos por día">
        {plan.days.map((d) => (
          <li key={d.offset}>
            {dayLabel(d.offset, now)}: {d.reviews} {d.reviews === 1 ? "repaso" : "repasos"}
          </li>
        ))}
      </ul>
      {plan.backlog > 0 ? <p className="meta">{plan.backlog} repasos más esperan después de esta semana.</p> : null}
    </>
  );
}
