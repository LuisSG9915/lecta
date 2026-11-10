#!/usr/bin/env bash
# Revisa documentos de diseño con el plugin Elephant-Goldfish Model (EGM)
# usando Claude Opus 5.5, y copia el informe al portapapeles para pegarlo donde haga falta.
#
# Uso:
#   scripts/egm-review.sh docs/reader-engine-diseno.md [otro.md ...]
#
# Salida:
#   docs/egm/reviews/<nombre>-<fecha>.md   informe final
#   docs/egm/reviews/<nombre>-<fecha>.log  registro completo de la ejecución
set -euo pipefail

MODEL="claude-opus-5-5"
OUT_DIR="docs/egm/reviews"
MAX_BUDGET_USD="${EGM_MAX_BUDGET_USD:-5}"

if [ "$#" -eq 0 ]; then
  echo "Uso: $0 <documento.md> [otro.md ...]" >&2
  exit 1
fi

# Versión instalada más reciente del plugin (los permisos de lectura apuntan aquí).
PLUGIN_DIR="$(ls -d "$HOME"/.claude/plugins/cache/egm/egm/*/ 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PLUGIN_DIR" ]; then
  echo "No encuentro el plugin egm en ~/.claude/plugins/cache. Instálalo con: claude plugin install egm@egm" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
status=0

for doc in "$@"; do
  if [ ! -f "$doc" ]; then
    echo "No existe: $doc" >&2
    status=1
    continue
  fi

  name="$(basename "$doc" .md)"
  stamp="$(date +%Y%m%d-%H%M)"
  report="$OUT_DIR/$name-$stamp.md"
  log="$OUT_DIR/$name-$stamp.log"

  echo "Revisando $doc con $MODEL → $report"

  if ! claude -p "/egm:egm-review $doc. Guarda el informe final en $report." \
      --model "$MODEL" \
      --add-dir "$PLUGIN_DIR" \
      --allowedTools "Read" "Grep" "Glob" "Agent" "Write(docs/egm/**)" \
      --max-budget-usd "$MAX_BUDGET_USD" \
      --output-format text \
      > "$log" 2>&1; then
    echo "Falló la revisión de $doc (ver $log)" >&2
    status=1
    continue
  fi

  if [ ! -s "$report" ]; then
    echo "La ejecución terminó pero no se generó $report (ver $log)" >&2
    status=1
    continue
  fi

  # Copia el informe al portapapeles (macOS) para pegarlo en Opus 5.5 u otro sitio.
  if command -v pbcopy >/dev/null 2>&1; then
    pbcopy < "$report"
    echo "Informe copiado al portapapeles: $report"
  else
    echo "Informe listo: $report"
  fi
done

exit "$status"
