# components/charts

## Overview

Dependency-free chart primitives (HTML + CSS + inline SVG, no chart library) used by the
owner-only analytics panel. All of them are pure presentational React components: they take
data through props and render. The only consumer is
[AdminInsights.tsx](../AdminInsights.tsx), which imports them through the barrel
[`index.ts`](./index.ts).

## Interface

- [index.ts] Barrel that re-exports every chart plus the `TableColumn` type.
- [ChartFrame.tsx:ChartFrame] `<figure>` wrapper with a title, an optional `hint`, a
  screen-reader-only `summary`, and an optional `table` that appears under a collapsible
  «Ver como tabla» `<details>`.
- [StatTile.tsx:StatTile] KPI tile (`label`, `value`, optional `delta`/`deltaTone`/`hint`).
- [BarChart.tsx:BarChart] Vertical bars from `{ label, shortLabel?, value, valueLabel? }[]`.
- [LineChart.tsx:LineChart] Line series chart.
- [Heatmap.tsx:Heatmap] Grid heatmap.
- [Funnel.tsx:Funnel] Funnel built from `steps`.
- [CohortGrid.tsx:CohortGrid] Retention grid over `AdminCohortRow[]` (type from
  `src/shared/admin-insights.ts`), with `weeks = 8` columns by default.
- [SegmentedBar.tsx:SegmentedBar] Single stacked bar built from `parts`.
- [DataTable.tsx:DataTable] Sortable generic table. [DataTable.tsx:TableColumn] defines
  `label`, an optional `sortValue` (a column without one cannot be sorted), `cell` and `align`.

## Invariants

- Data is never conveyed only through colour or shape. [ChartFrame.tsx:ChartFrame] accepts an
  equivalent `table` (see the comment above the component), and the charts expose an
  `ariaLabel` with `role="img"` ([BarChart.tsx:BarChart], [LineChart.tsx:LineChart],
  [Heatmap.tsx:Heatmap], [SegmentedBar.tsx:SegmentedBar]).
- Empty data renders a `<p className="chart-empty" role="note">` instead of an empty chart.
  For example, [BarChart.tsx:BarChart] does this when `data.length === 0 || max <= 0`.
- [DataTable.tsx:DataTable] makes each sortable header a button and sets `aria-sort` on the
  `<th>`.
- Only `index.ts` is the public entry point. `AdminInsights.tsx` imports from `"./charts"`.

## Side Effects

- None. These components hold local UI state only (for example, the sort state in
  [DataTable.tsx:DataTable]). They make no network, storage, or global DOM calls.

## Verification

- Run: `pnpm test`. This directory has no test files of its own; it is covered indirectly by
  `src/client/components/AdminInsights.test.ts`.
