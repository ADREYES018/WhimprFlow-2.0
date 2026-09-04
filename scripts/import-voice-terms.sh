#!/usr/bin/env bash
# One-off: seed the dictionary with the terms from the voice reference doc,
# section 8. Safe to re-run — DictionaryStore::add de-duplicates by spelling.
set -euo pipefail

DICT="$HOME/Library/Application Support/WhimprFlow/dictionary.json"
[ -f "$DICT" ] && cp "$DICT" "$DICT.bak"

python3 - "$DICT" <<'PY'
import json, sys, os

path = sys.argv[1]
terms = [
    ("Adriel Reyes", ["Adrial", "Adrielle", "Adriel Reyez"]),
    ("Claude Code", ["Cloud Code"]),
    ("CLAUDE.md", ["claude md"]),
    ("Anthropic", ["Anthropik"]),
    ("Opus", []), ("Sonnet", []), ("Haiku", []),
    ("MCP", ["M C P"]),
    ("NotebookLM", ["Notebook LM"]),
    ("Nano Banana Pro", ["nano banana"]),
    ("Wispr Flow", ["Whisper Flow", "Whimper Flow"]),
    ("Canva", ["Canvas"]),
    ("LinkedIn", ["Linked In"]),
    ("Netlify", ["Net Lify"]),
    ("Gemini", ["Jemini"]),
    ("GST", ["G S T"]),
    ("kanban", ["can ban"]),
]

store = {"entries": []}
if os.path.exists(path):
    with open(path) as f:
        store = json.load(f)

existing = {e["correct"].lower() for e in store.get("entries", [])}
added = 0
for correct, mishears in terms:
    if correct.lower() in existing:
        continue
    store.setdefault("entries", []).append(
        {"correct": correct, "mishears": mishears, "source": "manual"}
    )
    added += 1

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(store, f, indent=2)
print(f"added {added} entries, {len(store['entries'])} total")
PY
