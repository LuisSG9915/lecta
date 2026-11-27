// Plan de estudio adaptativo (Lecta+, F16), en «Tu recorrido». Chunk lazy:
// pide /api/study-plan, que calcula en el servidor sin IA. En free (402) no
// pinta nada (Journey da una sola nota de Lecta+); sin sesión u otro fallo, nada.
// Pendiente: programar la notificación local en la ventana del hábito
// (`calculateHabitWindow(habitSamples)` + `scheduleHabitReminder`) — hoy
// esa programación vive en otro flujo y no se duplica aquí.
import { useEffect, useState } from "react";
import type { StudyPlan } from "../../shared/study-plan";
import { accountFetch } from "../lib/account-fetch";
import { bookDisplayName } from "../lib/cover";

type State = { kind: "loading" } | { kind: "plan"; plan: StudyPlan } | { kind: "none" };

const DAY_NAMES = ["Hoy", "Mañana"];

function dayLabel(offset: number, now: Date): string {
  if (offset < DAY_NAMES.length) return DAY_NAMES[offset];
  const d = new Date(now.getTime() + offset * 86_400_000);
  const raw = d.toLocaleDateString("es-MX", { weekday: "short" }).replace(/\./g, "");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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
      {state.plan.empty ? (
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
  const bookName = book ? bookDisplayName({ name: book.name ?? "", title: book.title }) : "";
  const today = plan.days[0]?.reviews ?? 0;
  const upcoming = plan.days.filter((d) => d.offset >= 1 && d.reviews > 0);
  return (
    <>
      <p>
        Hoy: unos {plan.minutesToday} min ({plan.readingMinutes} de lectura
        {today > 0 ? ` y ${today} ${today === 1 ? "repaso" : "repasos"}` : ""}).
      </p>
      {plan.next && bookName ? (
        <p className="meta">Próximo capítulo: {plan.next.sectionIndex + 1} de «{bookName}».</p>
      ) : null}
      {upcoming.length > 0 ? (
        <p className="meta" aria-label="Repasos de los próximos días">
          Próximos repasos: {upcoming.map((d) => `${dayLabel(d.offset, now)} ${d.reviews}`).join(" · ")}.
        </p>
      ) : null}
      {plan.backlog > 0 ? <p className="meta">{plan.backlog} repasos más esperan después de esta semana.</p> : null}
    </>
  );
}
