import "../styles/admin-insights.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import Dialog from "./Dialog";
import {
  BarChart,
  ChartFrame,
  CohortGrid,
  DataTable,
  Funnel,
  Heatmap,
  LineChart,
  SegmentedBar,
  StatTile,
} from "./charts";
import { downloadText } from "../lib/export";
import {
  ADMIN_PERIOD_DAYS,
  normalizeAdminDays,
  type AdminDeviceClass,
  type AdminOverview,
  type AdminPeriodDays,
  type AdminUserDetail,
  type AdminUserRow,
  type FsrsStage,
} from "../../shared/admin-insights";

// ---------- Etiquetas ----------

const DOW_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const DEVICE_LABELS: Record<AdminDeviceClass, string> = {
  kindle: "Kindle / e-ink",
  phone: "Teléfono",
  tablet: "Tableta",
  desktop: "Computadora",
  bot: "Bot",
  unknown: "Sin dato",
};

const FUNNEL_LABELS: Record<string, string> = {
  signup: "Cuenta creada",
  read: "Leyó por primera vez",
  saved: "Guardó una palabra",
  reviewed: "Hizo un repaso",
  returned: "Volvió otro día",
  finished: "Terminó un libro",
};

const STAGE_LABELS: Record<FsrsStage, string> = {
  new: "Nueva",
  learning: "Aprendiendo",
  settled: "Asentada",
  mastered: "Dominada",
};

const RATING_LABELS: Record<string, string> = {
  again: "Otra vez",
  hard: "Difícil",
  good: "Bien",
  easy: "Fácil",
  correct: "Correcto",
  wrong: "Incorrecto",
  known: "Ya la sé",
};

// Mismo vocabulario que el Cuaderno (MODES de Vocabulary.tsx).
const KIND_LABELS: Record<string, string> = {
  meaning: "Significado",
  word: "Palabra",
  cloze: "Oración",
  choose: "Elegir palabra",
  match: "Parejas",
  sense: "Acepción",
  declared: "Ya la sé",
  reread: "Relectura",
  report: "Reporte",
  context: "Contexto",
  clozeNew: "Oración nueva",
  write: "Escribir",
  practice: "Práctica",
};

const SOURCE_LABELS: Record<string, string> = {
  calibration: "Calibración",
  declared: "Ya la sé",
  preparation: "Preparación",
  saved: "Cuaderno",
  inferred: "Inferido",
};

// ---------- Formato ----------

const fmtInt = (n: number) => Math.round(n).toLocaleString("es-MX");

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "Nunca";
  return new Date(ms).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const shortDay = (day: string) =>
  `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

/** «+12%» con signo; null si el periodo anterior no da base. */
function deltaText(cur: number, prev: number | null | undefined): string | null {
  if (prev == null || prev <= 0) return cur > 0 ? "nuevo" : null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function deltaTone(delta: string | null): "up" | "down" | "flat" | null {
  if (delta == null) return null;
  if (delta.startsWith("+") || delta === "nuevo") return "up";
  if (delta.startsWith("-")) return "down";
  return "flat";
}

// ---------- Panel ----------

type LoadState = "loading" | "error" | "denied" | AdminOverview;

type AdminInsightsProps = { onClose: () => void };

export default function AdminInsights({ onClose }: AdminInsightsProps) {
  const [days, setDays] = useState<AdminPeriodDays>(30);
  const [hideTest, setHideTest] = useState(true);
  const [state, setState] = useState<LoadState>("loading");
  const [detail, setDetail] = useState<
    "loading" | "error" | AdminUserDetail | null
  >(null);
  const [search, setSearch] = useState("");

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // fetchOverview no toca el estado: el efecto lo envuelve en una
  // función local con setState solo tras el await (la regla
  // set-state-in-effect lo exige), y los controles usan beginLoad.
  const fetchOverview = useCallback(async (): Promise<LoadState> => {
    try {
      const q = `days=${days}&tz=${encodeURIComponent(timeZone)}${
        hideTest ? "" : "&includeTest=1"
      }`;
      const res = await fetch(`/api/admin/insights?${q}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return "denied";
      if (!res.ok) return "error";
      return (await res.json()) as AdminOverview;
    } catch {
      return "error";
    }
  }, [days, hideTest, timeZone]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next = await fetchOverview();
      if (!cancelled) setState(next);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [fetchOverview]);

  // Los controles sí pueden marcar "loading": son eventos, no efecto.
  const beginLoad = useCallback(() => {
    setState("loading");
    void fetchOverview().then((next) => setState(next));
  }, [fetchOverview]);

  // Sin permiso la puerta se cierra sola, como pide el plan: la ruta
  // responde como si no existiera y el modal no queda enseñando nada.
  useEffect(() => {
    if (state === "denied") onClose();
  }, [state, onClose]);

  const openDetail = useCallback(
    async (userId: string) => {
      setDetail("loading");
      try {
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(userId)}?days=${days}&tz=${encodeURIComponent(timeZone)}`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          setDetail("error");
          return;
        }
        setDetail((await res.json()) as AdminUserDetail);
      } catch {
        setDetail("error");
      }
    },
    [days, timeZone],
  );

  const data = typeof state === "object" && state !== null ? state : null;

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.users;
    return data.users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q),
    );
  }, [data, search]);

  const exportUsersCsv = useCallback(() => {
    if (!data) return;
    const esc = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "correo",
      "nombre",
      "alta",
      "ultima_actividad",
      "minutos_periodo",
      "minutos_total",
      "libros_empezados",
      "libros_terminados",
      "palabras",
      "repasos",
      "aciertos_pct",
      "kindle",
      "anotaciones",
    ];
    const lines = data.users.map((u) =>
      [
        u.email,
        u.name,
        fmtDate(u.createdAt),
        fmtDate(u.lastActiveAt),
        Math.round(u.minutesPeriod),
        Math.round(u.minutesTotal),
        u.booksStarted,
        u.booksFinished,
        u.wordsSaved,
        u.reviews,
        u.recallPct ?? "",
        u.usesKindle ? "si" : "no",
        u.annotations,
      ]
        .map(esc)
        .join(","),
    );
    downloadText(
      `lecta-cuentas-${data.days}d.csv`,
      [header.join(","), ...lines].join("\n"),
      "text/csv;charset=utf-8",
    );
  }, [data]);

  const exportSeriesCsv = useCallback(() => {
    if (!data) return;
    const header = [
      "dia",
      "personas_activas",
      "minutos",
      "paginas_kindle",
      "repasos",
      "palabras",
      "consultas",
      "altas",
    ];
    const lines = data.series.map((s) =>
      [
        s.day,
        s.activeUsers,
        Math.round(s.readingMinutes),
        s.kindlePages,
        s.reviews,
        s.wordsSaved,
        s.consults,
        s.signups,
      ].join(","),
    );
    downloadText(
      `lecta-actividad-${data.days}d.csv`,
      [header.join(","), ...lines].join("\n"),
      "text/csv;charset=utf-8",
    );
  }, [data]);

  return (
    <Dialog label="Panel de análisis" onClose={onClose} className="adm-dialog">
      <div className="sheet-head">
        <strong className="sheet-title">Panel de análisis</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {detail !== null ? (
        <UserDetailView detail={detail} onBack={() => setDetail(null)} />
      ) : (
        <div className="adm-body">
          <div className="adm-toolbar">
            <label className="adm-field">
              Periodo
              <select
                value={days}
                onChange={(e) => {
                  setDays(normalizeAdminDays(e.target.value));
                  setState("loading");
                }}
              >
                {ADMIN_PERIOD_DAYS.map((d) => (
                  <option key={d} value={d}>
                    Últimos {d} días
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-field adm-check">
              <input
                type="checkbox"
                checked={hideTest}
                onChange={(e) => {
                  setHideTest(e.target.checked);
                  setState("loading");
                }}
              />
              Ocultar cuentas de prueba
            </label>
            <button
              type="button"
              className="btn--quiet"
              onClick={beginLoad}
              disabled={state === "loading"}
            >
              {state === "loading" ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          <p className="meta adm-note">
            Solo cuenta la actividad que llega al servidor: uso sin sesión
            no aparece. Minutos en Kindle es un estimado por el ritmo de
            páginas.
          </p>

          {state === "loading" ? (
            <p className="meta adm-loading">Consultando…</p>
          ) : state === "error" ? (
            <div className="adm-error" role="alert">
              <p>No se pudo cargar el panel.</p>
              <button type="button" className="btn btn--sm" onClick={beginLoad}>
                Reintentar
              </button>
            </div>
          ) : data ? (
            <OverviewSections
              data={data}
              users={filteredUsers}
              search={search}
              onSearch={setSearch}
              onOpenUser={(id) => void openDetail(id)}
              onExportUsers={exportUsersCsv}
              onExportSeries={exportSeriesCsv}
            />
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

// ---------- Secciones del panel ----------

function OverviewSections({
  data,
  users,
  search,
  onSearch,
  onOpenUser,
  onExportUsers,
  onExportSeries,
}: {
  data: AdminOverview;
  users: AdminUserRow[];
  search: string;
  onSearch: (v: string) => void;
  onOpenUser: (id: string) => void;
  onExportUsers: () => void;
  onExportSeries: () => void;
}) {
  const { kpis: k, kpisPrev: p } = data;

  const stat = (
    label: string,
    value: string,
    prev?: number | null,
    cur?: number,
    hint?: string,
  ) => {
    const delta = cur !== undefined ? deltaText(cur, prev) : null;
    return (
      <StatTile
        key={label}
        label={label}
        value={value}
        delta={delta}
        deltaTone={deltaTone(delta)}
        hint={hint}
      />
    );
  };

  const dayColumns = data.series.map((s) => ({
    label: s.day,
    shortLabel: shortDay(s.day),
    value: s.readingMinutes,
    valueLabel: `${s.day}: ${fmtMinutes(s.readingMinutes)}`,
  }));

  const heatValues = DOW_LABELS.map((_, dowIdx) =>
    Array.from({ length: 24 }, (_, h) => {
      const cell = data.hourHeatmap.find(
        (c) => c.dow === dowIdx + 1 && c.hour === h,
      );
      return cell?.minutes ?? 0;
    }),
  );

  return (
    <>
      <section className="adm-stats" aria-label="Resumen">
        {stat("Cuentas", fmtInt(k.totalAccounts), undefined, undefined)}
        {stat("Cuentas nuevas", fmtInt(k.newAccounts), p.newAccounts, k.newAccounts)}
        {stat("Activas hoy", fmtInt(k.activeToday))}
        {stat("Activas en 7 días", fmtInt(k.active7d), p.active7d, k.active7d)}
        {stat("Activas en 30 días", fmtInt(k.active30d), p.active30d, k.active30d)}
        {stat(
          "Constancia",
          k.stickiness != null ? `${Math.round(k.stickiness * 100)}%` : "—",
          undefined,
          undefined,
          "de las activas en 30 días entraron hoy",
        )}
        {stat(
          "Minutos leídos",
          fmtMinutes(k.readingMinutes),
          p.readingMinutes,
          k.readingMinutes,
          k.readingMinutesPerActive != null
            ? `${fmtMinutes(k.readingMinutesPerActive)} por persona activa`
            : undefined,
        )}
        {stat(
          "Minutos Kindle (est.)",
          fmtMinutes(k.kindleMinutesEst),
          p.kindleMinutesEst,
          k.kindleMinutesEst,
        )}
        {stat(
          "Libros terminados",
          fmtInt(k.booksFinished),
          p.booksFinished,
          k.booksFinished,
        )}
        {stat("Palabras guardadas", fmtInt(k.wordsSaved), p.wordsSaved, k.wordsSaved)}
        {stat(
          "Repasos",
          fmtInt(k.reviews),
          p.reviews,
          k.reviews,
          k.recallPct != null ? `${k.recallPct}% de aciertos` : undefined,
        )}
        {stat("Notas y pasajes", fmtInt(k.annotations), p.annotations, k.annotations)}
      </section>

      <ChartFrame
        title="Minutos por día"
        hint="intervalos reales unidos por dispositivo"
        table={
          <SeriesTable
            rows={data.series}
            columns={["Día", "Minutos", "Páginas Kindle", "Minutos Kindle (est.)"]}
            values={(s) => [
              s.day,
              fmtMinutes(s.readingMinutes),
              String(s.kindlePages),
              fmtMinutes(s.kindleMinutesEst),
            ]}
          />
        }
      >
        <BarChart
          data={dayColumns}
          unit="min"
          ariaLabel={`Minutos leídos por día, máximo ${fmtMinutes(
            Math.max(0, ...data.series.map((s) => s.readingMinutes)),
          )}`}
        />
      </ChartFrame>

      <ChartFrame
        title="Compromiso por día"
        table={
          <SeriesTable
            rows={data.series}
            columns={["Día", "Activas", "Repasos", "Palabras", "Consultas", "Altas"]}
            values={(s) => [
              s.day,
              String(s.activeUsers),
              String(s.reviews),
              String(s.wordsSaved),
              String(s.consults),
              String(s.signups),
            ]}
          />
        }
      >
        <LineChart
          xLabels={data.series.map((s) => shortDay(s.day))}
          series={[
            {
              id: "activas",
              label: "Personas activas",
              values: data.series.map((s) => s.activeUsers),
              tone: 0,
            },
            {
              id: "repasos",
              label: "Repasos",
              values: data.series.map((s) => s.reviews),
              tone: 1,
            },
            {
              id: "palabras",
              label: "Palabras guardadas",
              values: data.series.map((s) => s.wordsSaved),
              tone: 2,
            },
            {
              id: "consultas",
              label: "Consultas",
              values: data.series.map((s) => s.consults),
              tone: 3,
            },
          ]}
          ariaLabel="Personas activas, repasos, palabras guardadas y consultas por día"
        />
      </ChartFrame>

      <ChartFrame title="Embudo de activación" hint="desde el alta hasta hoy">
        <Funnel
          steps={data.funnel.map((f) => ({
            label: FUNNEL_LABELS[f.id] ?? f.id,
            count: f.users,
          }))}
          ariaLabel="Embudo de activación"
        />
      </ChartFrame>

      <ChartFrame
        title="Retención por semana de alta"
        hint="% de cada grupo que siguió activo cada semana"
      >
        <CohortGrid cohorts={data.cohorts} ariaLabel="Retención por semana de alta" />
      </ChartFrame>

      <ChartFrame
        title="Cuándo se lee"
        hint="minutos por día de la semana y hora"
        table={
          <HeatTable cells={data.hourHeatmap} />
        }
      >
        <Heatmap
          rowLabels={DOW_LABELS}
          colLabels={Array.from({ length: 24 }, (_, h) => `${h}`)}
          colLabelEvery={3}
          values={heatValues}
          cellLabel={(r, c, v) =>
            `${DOW_LABELS[r]} ${c}:00–${c + 1}:00 · ${fmtMinutes(v)}`
          }
          ariaLabel="Minutos leídos por día de la semana y hora"
        />
      </ChartFrame>

      <section className="adm-section" aria-label="Libros más leídos">
        <h3 className="eyebrow">Libros más leídos</h3>
        <DataTable
          ariaLabel="Libros más leídos"
          rows={data.topBooks}
          rowKey={(b) => b.bookHash}
          emptyLabel="Aún no hay lectura registrada en el periodo."
          columns={[
            {
              label: "Libro",
              sortValue: (b) => b.title ?? "",
              cell: (b) => (
                <BookCell title={b.title} author={b.author} language={b.language} hash={b.bookHash} />
              ),
            },
            { label: "Lectores", sortValue: (b) => b.readers, align: "right", cell: (b) => b.readers },
            { label: "Minutos", sortValue: (b) => b.minutes, align: "right", cell: (b) => fmtMinutes(b.minutes) },
            {
              label: "Progreso",
              sortValue: (b) => b.avgProgress,
              align: "right",
              cell: (b) => `${Math.round(b.avgProgress * 100)}%`,
            },
            { label: "Terminaron", sortValue: (b) => b.finished, align: "right", cell: (b) => b.finished },
            { label: "Última apertura", sortValue: (b) => b.lastOpenAt, align: "right", cell: (b) => fmtDate(b.lastOpenAt) },
          ]}
          initialSort={{ column: 2 }}
        />
      </section>

      {data.pausedBooks.length > 0 ? (
        <section className="adm-section" aria-label="Libros en pausa">
          <h3 className="eyebrow">Libros en pausa</h3>
          <p className="meta">Progreso entre 5 % y 99 % y 14 días sin abrirse.</p>
          <DataTable
            ariaLabel="Libros en pausa"
            rows={data.pausedBooks}
            rowKey={(b) => b.bookHash}
            columns={[
              {
                label: "Libro",
                cell: (b) => (
                  <BookCell title={b.title} author={b.author} language={b.language} hash={b.bookHash} />
                ),
              },
              { label: "Lectores", sortValue: (b) => b.readers, align: "right", cell: (b) => b.readers },
              {
                label: "Progreso",
                sortValue: (b) => b.avgProgress,
                align: "right",
                cell: (b) => `${Math.round(b.avgProgress * 100)}%`,
              },
              { label: "Última apertura", sortValue: (b) => b.lastOpenAt, align: "right", cell: (b) => fmtDate(b.lastOpenAt) },
            ]}
          />
        </section>
      ) : null}

      <section className="adm-section" aria-label="Aprendizaje">
        <h3 className="eyebrow">Aprendizaje</h3>
        <div className="adm-two-col">
          <ChartFrame title="Palabras por etapa">
            <SegmentedBar
              ariaLabel="Palabras por etapa de aprendizaje"
              parts={(
                ["new", "learning", "settled", "mastered"] as FsrsStage[]
              ).map((stage, i) => ({
                id: stage,
                label: STAGE_LABELS[stage],
                value: data.learning.stages[stage] ?? 0,
                tone: i,
              }))}
            />
          </ChartFrame>
          <ChartFrame title="Calificaciones" hint="en el periodo">
            <SegmentedBar
              ariaLabel="Calificaciones en el periodo"
              parts={Object.entries(data.learning.ratings).map(
                ([rating, n], i) => ({
                  id: rating,
                  label: RATING_LABELS[rating] ?? rating,
                  value: n,
                  tone: i,
                }),
              )}
            />
          </ChartFrame>
        </div>
        <div className="adm-two-col">
          <section aria-label="Repasos por ejercicio">
            <h4 className="adm-sub">Repasos por ejercicio</h4>
            <DataTable
              ariaLabel="Repasos por tipo de ejercicio"
              rows={Object.entries(data.learning.reviewKinds).map(
                ([kind, n]) => ({ kind, n }),
              )}
              rowKey={(r) => r.kind}
              columns={[
                {
                  label: "Ejercicio",
                  sortValue: (r) => r.kind,
                  cell: (r) => KIND_LABELS[r.kind] ?? r.kind,
                },
                { label: "Repasos", sortValue: (r) => r.n, align: "right", cell: (r) => fmtInt(r.n) },
              ]}
              initialSort={{ column: 1 }}
              emptyLabel="Sin repasos en el periodo."
            />
          </section>
          <section aria-label="Lemas conocidos por idioma">
            <h4 className="adm-sub">Lemas conocidos por idioma</h4>
            <DataTable
              ariaLabel="Lemas marcados como conocidos por idioma"
              rows={data.learning.knowledgeByLang}
              rowKey={(r) => r.language}
              columns={[
                { label: "Idioma", sortValue: (r) => r.language, cell: (r) => r.language },
                { label: "Lemas", sortValue: (r) => r.known, align: "right", cell: (r) => fmtInt(r.known) },
                {
                  label: "De dónde salieron",
                  cell: (r) =>
                    Object.entries(r.sources)
                      .map(([s, n]) => `${SOURCE_LABELS[s] ?? s} ${n}`)
                      .join(" · "),
                },
              ]}
              initialSort={{ column: 1 }}
              emptyLabel="Sin lemas registrados."
            />
          </section>
        </div>
      </section>

      <section className="adm-section" aria-label="Dispositivos e IA">
        <h3 className="eyebrow">Dispositivos e IA</h3>
        <div className="adm-two-col">
          <ChartFrame title="Sesiones vigentes por dispositivo">
            <SegmentedBar
              ariaLabel="Sesiones vigentes por tipo de dispositivo"
              parts={data.devices.map((d, i) => ({
                id: d.device,
                label: DEVICE_LABELS[d.device],
                value: d.sessions,
                tone: i,
              }))}
              emptyLabel="Sin sesiones vigentes."
            />
          </ChartFrame>
          <section aria-label="Uso de IA por función">
            <h4 className="adm-sub">
              IA por función{" "}
              <span className="chart-frame-hint">en el periodo</span>
            </h4>
            <DataTable
              ariaLabel="Uso de IA por función"
              rows={data.aiByScope}
              rowKey={(r) => r.scope}
              columns={[
                { label: "Función", sortValue: (r) => r.scope, cell: (r) => r.scope },
                { label: "Unidades", sortValue: (r) => r.units, align: "right", cell: (r) => fmtInt(r.units) },
                { label: "Personas", sortValue: (r) => r.users, align: "right", cell: (r) => r.users },
              ]}
              initialSort={{ column: 1 }}
              emptyLabel="Sin uso en el periodo."
            />
          </section>
        </div>
      </section>

      <section className="adm-section" aria-label="Cuentas">
        <div className="adm-accounts-head">
          <h3 className="eyebrow">Cuentas</h3>
          <div className="adm-accounts-actions">
            <input
              type="search"
              className="adm-search"
              placeholder="Buscar por correo o nombre"
              aria-label="Buscar por correo o nombre"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
            <button type="button" className="btn--quiet" onClick={onExportUsers}>
              Exportar cuentas (CSV)
            </button>
            <button type="button" className="btn--quiet" onClick={onExportSeries}>
              Exportar días (CSV)
            </button>
          </div>
        </div>
        {data.truncatedUsers ? (
          <p className="meta">
            Mostrando las primeras 1 000 cuentas por última actividad.
          </p>
        ) : null}
        <DataTable
          ariaLabel="Cuentas con su actividad"
          rows={users}
          rowKey={(u) => u.id}
          columns={[
            {
              label: "Cuenta",
              sortValue: (u) => u.email,
              cell: (u) => (
                <span className="adm-user-cell">
                  <strong>{u.name || u.email}</strong>
                  <span className="meta">{u.email}</span>
                </span>
              ),
            },
            { label: "Alta", sortValue: (u) => u.createdAt, cell: (u) => fmtDate(u.createdAt) },
            {
              label: "Última actividad",
              sortValue: (u) => u.lastActiveAt,
              cell: (u) => fmtDateTime(u.lastActiveAt),
            },
            {
              label: `Minutos (${data.days} d)`,
              sortValue: (u) => u.minutesPeriod,
              align: "right",
              cell: (u) => fmtMinutes(u.minutesPeriod),
            },
            {
              label: "Minutos total",
              sortValue: (u) => u.minutesTotal,
              align: "right",
              cell: (u) => fmtMinutes(u.minutesTotal),
            },
            {
              label: "Libros",
              sortValue: (u) => u.booksStarted,
              align: "right",
              cell: (u) => `${u.booksStarted} · ${u.booksFinished} term.`,
            },
            {
              label: "Palabras",
              sortValue: (u) => u.wordsSaved,
              align: "right",
              cell: (u) => fmtInt(u.wordsSaved),
            },
            {
              label: "Repasos",
              sortValue: (u) => u.reviews,
              align: "right",
              cell: (u) => fmtInt(u.reviews),
            },
            {
              label: "Aciertos",
              sortValue: (u) => u.recallPct,
              align: "right",
              cell: (u) => (u.recallPct != null ? `${u.recallPct}%` : "—"),
            },
            {
              label: "Kindle",
              align: "center",
              cell: (u) => (u.usesKindle ? "Sí" : ""),
            },
            {
              label: "",
              cell: (u) => (
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => onOpenUser(u.id)}
                >
                  Ver
                </button>
              ),
            },
          ]}
          initialSort={{ column: 2 }}
          emptyLabel="Sin cuentas que coincidan con la búsqueda."
        />
      </section>
    </>
  );
}

function BookCell({
  title,
  author,
  language,
  hash,
}: {
  title: string | null;
  author: string | null;
  language?: string | null;
  hash: string;
}) {
  return (
    <span className="adm-book-cell">
      <strong>{title ?? `Libro ${hash.slice(0, 8)}`}</strong>
      {author ? <span className="meta">{author}</span> : null}
      {language ? <span className="meta">{language}</span> : null}
    </span>
  );
}

function SeriesTable({
  rows,
  columns,
  values,
}: {
  rows: AdminOverview["series"];
  columns: string[];
  values: (s: AdminOverview["series"][number]) => string[];
}) {
  return (
    <table className="adm-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.day}>
            {values(s).map((v, i) => (
              <td key={i}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HeatTable({ cells }: { cells: AdminOverview["hourHeatmap"] }) {
  const sorted = [...cells]
    .filter((c) => c.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 40);
  return (
    <table className="adm-table">
      <thead>
        <tr>
          <th scope="col">Día</th>
          <th scope="col">Hora</th>
          <th scope="col">Minutos</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={`${c.dow}-${c.hour}`}>
            <td>{DOW_LABELS[c.dow - 1]}</td>
            <td>
              {c.hour}:00–{c.hour + 1}:00
            </td>
            <td>{fmtMinutes(c.minutes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Ficha por persona ----------

function UserDetailView({
  detail,
  onBack,
}: {
  detail: "loading" | "error" | AdminUserDetail;
  onBack: () => void;
}) {
  if (detail === "loading") {
    return (
      <div className="adm-body">
        <button type="button" className="btn--quiet" onClick={onBack}>
          ← Panel
        </button>
        <p className="meta adm-loading">Cargando ficha…</p>
      </div>
    );
  }
  if (detail === "error") {
    return (
      <div className="adm-body">
        <button type="button" className="btn--quiet" onClick={onBack}>
          ← Panel
        </button>
        <div className="adm-error" role="alert">
          <p>No se pudo cargar la ficha.</p>
        </div>
      </div>
    );
  }

  const u = detail;
  return (
    <div className="adm-body">
      <button type="button" className="btn--quiet" onClick={onBack}>
        ← Panel
      </button>

      <section className="adm-userhead" aria-label="Cuenta">
        <h3 className="adm-userhead-name">{u.user.name || u.user.email}</h3>
        <p className="meta">
          {u.user.email} · alta {fmtDate(u.user.createdAt)} · última
          actividad {fmtDateTime(u.lastActiveAt)}
        </p>
      </section>

      <ChartFrame title="Minutos y páginas Kindle por día">
        <LineChart
          xLabels={u.series.map((s) => shortDay(s.day))}
          series={[
            {
              id: "min",
              label: "Minutos",
              values: u.series.map((s) => s.minutes),
              tone: 0,
            },
            {
              id: "k",
              label: "Páginas Kindle",
              values: u.series.map((s) => s.kindlePages),
              tone: 1,
            },
            {
              id: "rep",
              label: "Repasos",
              values: u.series.map((s) => s.reviews),
              tone: 2,
            },
            {
              id: "con",
              label: "Consultas",
              values: u.series.map((s) => s.consults),
              tone: 3,
            },
          ]}
          ariaLabel="Minutos, páginas Kindle, repasos y consultas por día"
          emptyLabel="Sin actividad en el periodo."
        />
      </ChartFrame>

      <section className="adm-section" aria-label="Libros de la persona">
        <h3 className="eyebrow">Libros</h3>
        <DataTable
          ariaLabel="Libros de la persona"
          rows={u.books}
          rowKey={(b) => b.bookHash}
          columns={[
            {
              label: "Libro",
              cell: (b) => (
                <BookCell
                  title={b.title}
                  author={b.author}
                  language={b.language}
                  hash={b.bookHash}
                />
              ),
            },
            {
              label: "Progreso",
              sortValue: (b) => b.progress,
              align: "right",
              cell: (b) => `${Math.round(b.progress * 100)}%`,
            },
            {
              label: "Minutos",
              sortValue: (b) => b.minutes,
              align: "right",
              cell: (b) => fmtMinutes(b.minutes),
            },
            {
              label: "Última apertura",
              sortValue: (b) => b.lastOpenAt,
              align: "right",
              cell: (b) => fmtDate(b.lastOpenAt),
            },
            {
              label: "Estado",
              cell: (b) => (b.finished ? "Terminado" : ""),
            },
          ]}
          initialSort={{ column: 2 }}
          emptyLabel="Sin libros con actividad en el periodo."
        />
      </section>

      <div className="adm-two-col">
        <ChartFrame title="Palabras por etapa">
          <SegmentedBar
            ariaLabel="Palabras por etapa de la persona"
            parts={(["new", "learning", "settled", "mastered"] as FsrsStage[]).map(
              (stage, i) => ({
                id: stage,
                label: STAGE_LABELS[stage],
                value: u.stages[stage] ?? 0,
                tone: i,
              }),
            )}
          />
        </ChartFrame>
        <section aria-label="Dispositivos de la persona">
          <h4 className="adm-sub">Dispositivos</h4>
          <DataTable
            ariaLabel="Dispositivos de la persona"
            rows={u.devices}
            rowKey={(d) => d.device}
            columns={[
              { label: "Tipo", cell: (d) => DEVICE_LABELS[d.device] },
              {
                label: "Sesiones",
                sortValue: (d) => d.sessions,
                align: "right",
                cell: (d) => d.sessions,
              },
            ]}
            emptyLabel="Sin sesiones vigentes."
          />
          <p className="meta">Consultas de palabras: {fmtInt(u.consultsTotal)}</p>
        </section>
      </div>

      <section className="adm-section" aria-label="Repasos por semana">
        <h3 className="eyebrow">Repasos por semana</h3>
        <DataTable
          ariaLabel="Repasos y aciertos por semana"
          rows={u.recallByWeek}
          rowKey={(r) => r.week}
          columns={[
            { label: "Semana", sortValue: (r) => r.week, cell: (r) => r.week },
            {
              label: "Repasos",
              sortValue: (r) => r.reviews,
              align: "right",
              cell: (r) => fmtInt(r.reviews),
            },
            {
              label: "Aciertos",
              sortValue: (r) => r.recallPct,
              align: "right",
              cell: (r) => (r.recallPct != null ? `${r.recallPct}%` : "—"),
            },
          ]}
          emptyLabel="Sin repasos en el periodo."
        />
      </section>

      <section className="adm-section" aria-label="Idiomas">
        <h3 className="eyebrow">Idiomas</h3>
        <DataTable
          ariaLabel="Idiomas de la persona"
          rows={u.languages}
          rowKey={(l) => l.language}
          columns={[
            { label: "Idioma", sortValue: (l) => l.language, cell: (l) => l.language },
            {
              label: "Lemas conocidos",
              sortValue: (l) => l.lemmasKnown,
              align: "right",
              cell: (l) => fmtInt(l.lemmasKnown),
            },
            {
              label: "Palabras guardadas",
              sortValue: (l) => l.wordsSaved,
              align: "right",
              cell: (l) => fmtInt(l.wordsSaved),
            },
          ]}
          emptyLabel="Sin datos de idioma."
        />
      </section>
    </div>
  );
}
