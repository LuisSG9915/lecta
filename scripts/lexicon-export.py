#!/usr/bin/env python3
"""Exporta el catálogo léxico base de Lecta a TSV (Fase 2).

Genera dos archivos en data/lexicon/ (no versionados):

  es-forms.tsv   form <TAB> lemma            — de simplemma (es.plzma)
  es-lemmas.tsv  lemma <TAB> zipf            — zipf medido con wordfreq

Requisitos (solo para correr esto, no para la app):

  python3 -m venv /tmp/lecta-lex-env
  /tmp/lecta-lex-env/bin/pip install simplemma==1.1.2 wordfreq==3.1.1
  /tmp/lecta-lex-env/bin/python3 scripts/lexicon-export.py

Después: `node --env-file=.env scripts/lexicon-load.mjs` carga los TSV a
la base indicada por DATABASE_URL.
"""

import lzma
import pickle
import sys
from pathlib import Path

try:
    import simplemma  # noqa: F401
    from simplemma.strategies.dictionaries.dictionary_factory import DATA_FOLDER
    from wordfreq import zipf_frequency
except ImportError:
    sys.exit("Faltan dependencias: pip install simplemma==1.1.2 wordfreq==3.1.1")

LANG = "es"
OUT_DIR = Path("data/lexicon")


def load_forms(lang: str) -> dict[str, str]:
    path = Path(DATA_FOLDER) / f"{lang}.plzma"
    raw = pickle.loads(lzma.decompress(path.read_bytes()))
    return {form.decode("utf-8"): lemma.decode("utf-8") for form, lemma in raw.items()}


def main() -> None:
    forms = load_forms(LANG)
    lemmas = sorted(set(forms.values()))
    print(f"{len(forms)} formas, {len(lemmas)} lemas únicos")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    forms_path = OUT_DIR / f"{LANG}-forms.tsv"
    with forms_path.open("w", encoding="utf-8") as out:
        for form, lemma in sorted(forms.items()):
            out.write(f"{form}\t{lemma}\n")
    print(f"→ {forms_path}")

    lemmas_path = OUT_DIR / f"{LANG}-lemmas.tsv"
    known = 0
    with lemmas_path.open("w", encoding="utf-8") as out:
        for lemma in lemmas:
            # wordfreq devuelve 0.0 cuando el lema no está en su
            # corpus: es ausencia de medición, no un 0 real. Escribir
            # 0.00 lo haría parecer el lema más raro del idioma y lo
            # colaría en toda predicción — se exporta vacío (→ NULL).
            zipf = zipf_frequency(lemma, LANG)
            if zipf > 0:
                known += 1
                out.write(f"{lemma}\t{zipf:.2f}\n")
            else:
                out.write(f"{lemma}\t\n")
    print(f"→ {lemmas_path} ({known} lemas con frecuencia > 0)")


if __name__ == "__main__":
    main()
