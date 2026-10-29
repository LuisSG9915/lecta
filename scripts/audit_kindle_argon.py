#!/usr/bin/env python3
"""
Auditoría profunda del subsistema Kindle de Lecta con Gemini 4 Argon (gemini-4-argon).
Carga el dossier completo (180k caracteres) de artifacts/auditoria-kindle-para-argon.md
y ejecuta la auditoría vía Interactions API de Google Gemini con thinking_level: high.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOSSIER_PATH = ROOT / "artifacts" / "auditoria-kindle-para-argon.md"

def get_api_key():
    # 1. Argumento CLI
    for arg in sys.argv:
        if arg.startswith("--key="):
            return arg.split("=", 1)[1]
    # 2. Variable de entorno
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ.get("GEMINI_API_KEY")
    if os.environ.get("GOOGLE_API_KEY"):
        return os.environ.get("GOOGLE_API_KEY")
    # 3. Archivo .env
    env_file = ROOT / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("GEMINI_API_KEY=") or line.startswith("GOOGLE_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def main():
    print("=" * 70)
    print("  🔬 AUDITORÍA PROFUNDA DE KINDLE CON GOOGLE GEMINI 4 ARGON")
    print("=" * 70)

    if not DOSSIER_PATH.exists():
        print(f"Error: No se encontró el dossier en {DOSSIER_PATH}")
        print("Ejecuta primero: node scripts/generar-auditoria-argon.mjs")
        sys.exit(1)

    with open(DOSSIER_PATH, "r", encoding="utf-8") as f:
        dossier_content = f.read()

    print(f"✓ Dossier cargado: {len(dossier_content):,} caracteres (~{len(dossier_content)//4:,} tokens).")
    
    is_live = "--live" in sys.argv
    api_key = get_api_key()

    if not is_live:
        print("\n🔍 MODO DRY-RUN ACTIVADO:")
        print("   El dossier está listo para enviarse a Gemini 4 Argon.")
        print("   Para ejecutarlo en vivo por terminal:")
        print("   python3 scripts/audit_kindle_argon.py --live --key=TU_API_KEY\n")
        print(f"   Archivo del dossier: {DOSSIER_PATH}")
        if api_key:
            print(f"   Clave detectada: {api_key[:6]}...{api_key[-4:]}")
        sys.exit(0)

    if not api_key:
        print("\n❌ Error: Se especificó --live pero no se encontró GEMINI_API_KEY.")
        print("   Provee la clave con --key=AIzaSy... o export GEMINI_API_KEY=...")
        sys.exit(1)

    url = "https://generativelanguage.googleapis.com/v1beta/interactions"
    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json"
    }

    payload = {
        "model": "gemini-4-argon",
        "input": dossier_content,
        "background": True,
        "generation_config": {
            "max_output_tokens": 131072,
            "thinking_level": "high"
        }
    }

    print("\n🚀 Enviando dossier a Gemini 4 Argon con thinking_level='high'...")
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"❌ Error HTTP {e.code}: {e.read().decode('utf-8')}")
        sys.exit(1)

    interaction_id = data.get("id")
    print(f"✅ Interacción creada exitosamente. ID: {interaction_id}")
    print("⏳ Gemini 4 Argon está razonando en profundidad sobre el código...")

    poll_url = f"{url}/{interaction_id}"
    status = data.get("status", "in_progress")
    poll_count = 0

    while status in ("in_progress", "queued"):
        poll_count += 1
        time.sleep(6)
        print(f"   [Paso {poll_count}] Estado: {status} (pensando y analizando código)...", end="\r", flush=True)

        poll_req = urllib.request.Request(poll_url, headers={"x-goog-api-key": api_key})
        try:
            with urllib.request.urlopen(poll_req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                status = data.get("status", "completed")
        except urllib.error.HTTPError as e:
            print(f"\n❌ Error al consultar estado: {e}")
            sys.exit(1)

    print(f"\n\n🏁 Interacción finalizada con estado: {status}")

    final_text = ""
    steps = data.get("steps", [])
    for step in steps:
        if step.get("type") == "model_output":
            for content in step.get("content", []):
                if content.get("type") == "text":
                    final_text += content.get("text", "") + "\n\n"

    if not final_text and data.get("output_text"):
        final_text = data.get("output_text")

    out_file = ROOT / "artifacts" / f"resultado-argon-audit-{int(time.time())}.md"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(f"# Dictamen de Auditoría Gemini 4 Argon\n**ID:** {interaction_id}\n\n{final_text}")

    print(f"📄 Dictamen de Gemini 4 Argon guardado en: {out_file}")
    print(f"   Longitud: {len(final_text):,} caracteres.")

if __name__ == "__main__":
    main()
