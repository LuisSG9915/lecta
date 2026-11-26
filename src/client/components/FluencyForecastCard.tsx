// Predicción de fluidez (Lecta+, F17), dentro de la tarjeta de cada idioma de
// «Tu recorrido». Chunk lazy: pide /api/fluency-forecast (sin IA). En free
// (402) no pinta nada (Journey da una sola nota de Lecta+); el nivel actual
// lo pinta Journey como siempre. Sin sesión u otro fallo, nada.
import { useEffect, useState } from "react";
import type { FluencyForecast } from "../../shared/fluency-forecast";
import { accountFetch } from "../lib/account-fetch";

type State =
  | { kind: "loading" }
  | { kind: "forecast"; forecast: FluencyForecast }
  | { kind: "none" };

function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString("es", { month: "long", year: "numeric" });
}

// Ritmo semanal que acercaría la meta a ~2 años, con los datos del servidor.
function paceHint(forecast: Extract<FluencyForecast, { weeklyRate: number }>): string {
  const remaining = Math.max(0, forecast.targetWords - forecast.consolidated);
  const needed = Math.ceil(remaining / 104);
  return needed > forecast.weeklyRate
    ? `con unas ${needed} palabras consolidadas por semana la verías en unos 2 años.`
    : "sigue sumando palabras cada semana y se acerca.";
}

function Body({ forecast }: { forecast: FluencyForecast }) {
  if (forecast.status === "no-data") return <p className="meta">{forecast.note}</p>;
  const pct = Math.round(forecast.currentCoverage * 100);
  const goal = Math.round(forecast.targetCoverage * 100);
  if (forecast.status === "reached") {
    return <p>Ya entiendes en torno al {goal} % de las palabras de un libro típico.</p>;
  }
  return (
    <>
      <p>
        Hoy entiendes cerca del {pct} % de las palabras de un libro típico.{" "}
        {forecast.status === "far"
          ? `Cuándo entenderías casi todas (el ${goal} %) depende de tu ritmo: ${paceHint(forecast)}`
          : `Entenderías casi todas (el ${goal} %) hacia ${monthYear(forecast.at as number)}.`}
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
      <Body forecast={state.forecast} />
    </div>
  );
}
