// Predicción de fluidez (Lecta+, F17), dentro de la tarjeta de cada idioma de
// «Tu recorrido». Chunk lazy: pide /api/fluency-forecast (sin IA). En free
// (402) muestra la nota de Lecta+; el nivel actual lo pinta Journey como
// siempre. Sin sesión u otro fallo, nada.
import { useEffect, useState } from "react";
import type { FluencyForecast } from "../../shared/fluency-forecast";
import { accountFetch } from "../lib/account-fetch";
import PlanNote from "./PlanNote";

type State =
  | { kind: "loading" }
  | { kind: "free" }
  | { kind: "forecast"; forecast: FluencyForecast }
  | { kind: "none" };

function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString("es", { month: "long", year: "numeric" });
}

function Body({ forecast }: { forecast: FluencyForecast }) {
  if (forecast.status === "no-data") return <p className="meta">{forecast.note}</p>;
  const pct = Math.round(forecast.currentCoverage * 100);
  const goal = Math.round(forecast.targetCoverage * 100);
  if (forecast.status === "reached") {
    return <p>Ya estás en torno al {goal} % de cobertura de un libro típico.</p>;
  }
  return (
    <>
      <p>
        Hoy cubres cerca del {pct} % de un libro típico. {forecast.status === "far"
          ? `Llegar al ${goal} % te llevaría más de 5 años.`
          : `Llegarías al ${goal} % hacia ${monthYear(forecast.at as number)}.`}
      </p>
      <p className="meta">
        {forecast.note}: unas {Math.round(forecast.weeklyRate)} palabras consolidadas por semana.
        {forecast.earliestAt
          ? ` Entre ${monthYear(forecast.earliestAt)} y ${forecast.latestAt ? monthYear(forecast.latestAt) : "más de 5 años"}.`
          : ""}
      </p>
    </>
  );
}

export default function FluencyForecastCard({ lang }: { lang: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    accountFetch(`/api/fluency-forecast?lang=${encodeURIComponent(lang)}`)
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 402) return setState({ kind: "free" });
        if (!res.ok) return setState({ kind: "none" });
        const body = (await res.json()) as { forecast: FluencyForecast };
        setState({ kind: "forecast", forecast: body.forecast });
      })
      .catch(() => alive && setState({ kind: "none" }));
    return () => {
      alive = false;
    };
  }, [lang]);

  if (state.kind === "loading" || state.kind === "none") return null;

  return (
    <div className="journey-fluency-forecast" data-testid="fluency-forecast">
      <h4 className="journey-insight-title">Predicción de fluidez</h4>
      {state.kind === "free" ? (
        <PlanNote
          feature="fluency"
          title="Predicción de fluidez con Lecta+"
          detail="Cuándo llegarías al 95 % de cobertura de un libro típico, con tu ritmo real."
        />
      ) : (
        <Body forecast={state.forecast} />
      )}
    </div>
  );
}
