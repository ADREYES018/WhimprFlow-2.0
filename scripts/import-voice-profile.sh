#!/usr/bin/env bash
# Seed style.json from references/voice-tone-reference.md. Overwrites the base
# profile and the five contexts; leaves samples and auto-learn state alone.
set -euo pipefail

STYLE="$HOME/Library/Application Support/WhimprFlow/style.json"
[ -f "$STYLE" ] && cp "$STYLE" "$STYLE.bak"

python3 - "$STYLE" <<'PY'
import json, os, sys, time

path = sys.argv[1]
now = int(time.time())

BANNED = ["game-changer", "revolutionary", "insane", "mind-blowing", "amazing",
          "leverage", "unlock", "just", "really", "actually", "simply",
          "basically", "kind of", "sort of"]

def profile(words, tone):
    return {
        "avg_sentence_words": words,
        "contractions": True,
        "punctuation_notes": "no em-dashes, use a comma or a period instead",
        "banned_words": BANNED,
        "tone_notes": tone,
        "derived_at": now,
    }

store = {}
if os.path.exists(path):
    with open(path) as f:
        store = json.load(f)

store["base"] = profile(
    12,
    "Casual and direct. A person talking, not a brand posting. Lead with the "
    "answer, context after. Confident without guru posturing. No preamble, "
    "no padding, no fake enthusiasm.",
)

store["contexts"] = [
    {
        "id": "linkedin",
        "name": "LinkedIn post",
        "bundle_ids": ["com.google.Chrome", "com.apple.Safari"],
        "profile": profile(
            12,
            "Teaching one usable idea to people learning AI. Concrete tools and "
            "numbers. No influencer cadence, no one-line-per-paragraph drama.",
        ),
    },
    {
        "id": "instagram",
        "name": "Instagram caption",
        "bundle_ids": [],
        "profile": profile(8, "Short, personal, in the moment. The video carries it."),
    },
    {
        "id": "email",
        "name": "Client email",
        "bundle_ids": ["com.apple.mail", "com.microsoft.Outlook"],
        "profile": profile(
            14,
            "Casual-professional. Warm and direct, no fluff, no corporate polish. "
            "Never turn 'I want' into 'I would like to request'.",
        ),
    },
    {
        "id": "job",
        "name": "Job application",
        "bundle_ids": [],
        "profile": profile(
            15, "Professional but still human. No buzzword soup, no self-promotion cliches."
        ),
    },
    {
        "id": "notes",
        "name": "Notes to self",
        "bundle_ids": ["com.apple.Notes", "dev.whimprflow.app"],
        "profile": profile(6, "Fragments are fine. Cut filler, change nothing else."),
    },
]

store.setdefault("samples", [])
store.setdefault("auto_learn", False)
store.setdefault("dictations_since_derive", 0)
store.setdefault("pending", None)

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(store, f, indent=2)
print(f"seeded base profile and {len(store['contexts'])} contexts")
PY
