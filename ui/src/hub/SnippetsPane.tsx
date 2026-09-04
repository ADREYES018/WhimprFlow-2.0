import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card } from "./ui";
import { Icon } from "./icons";
import { ActionError, useAction } from "./useAction";
import {
  getSnippets,
  addSnippet,
  updateSnippet,
  removeSnippet,
  type Snippet,
} from "./api";

function SnippetForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Snippet;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [trigger, setTrigger] = useState(initial?.trigger ?? "");
  const [expansion, setExpansion] = useState(initial?.expansion ?? "");
  const [saving, setSaving] = useState(false);

  const inputStyle = {
    width: "100%",
    background: theme.cardBgSubtle,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: "9px 12px",
    color: theme.textBody,
    fontFamily: font.ui,
    fontSize: 13.5,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  const { error, clearError, run } = useAction();

  const handleSubmit = async () => {
    const trig = trigger.trim();
    const exp = expansion.trim();
    if (!trig || !exp || saving) return;
    setSaving(true);
    const ok = await run(async () => {
      if (initial) {
        await updateSnippet(trig, exp, initial.enabled);
      } else {
        await addSnippet(trig, exp);
      }
    });
    setSaving(false);
    // Only close the form on success. On failure it stays open with the text
    // intact and the error above it, so nothing the user typed is lost.
    if (ok) onSave();
  };

  return (
    <Card style={{ marginBottom: 16, borderColor: theme.accentSoftBorder }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 12 }}>
        {initial ? "Edit snippet" : "Add a snippet"}
      </div>
      {error && <ActionError message={error} onDismiss={clearError} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Trigger phrase <span style={{ color: theme.textFaint }}>(the words you speak)</span>
          </label>
          <input
            autoFocus
            value={trigger}
            disabled={Boolean(initial)}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="e.g. my signature"
            style={{
              ...inputStyle,
              opacity: initial ? 0.75 : 1,
              cursor: initial ? "not-allowed" : "text",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Expansion text <span style={{ color: theme.textFaint }}>(what gets typed out)</span>
          </label>
          <textarea
            rows={4}
            value={expansion}
            onChange={(e) => setExpansion(e.target.value)}
            placeholder="Best regards,&#10;Adriel Reyes"
            style={{
              ...inputStyle,
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Button variant="accent" onClick={() => void handleSubmit()} disabled={saving || !trigger.trim() || !expansion.trim()}>
          {saving ? "Saving..." : initial ? "Save changes" : "Add snippet"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function SnippetRow({
  snippet,
  onToggle,
  onEdit,
  onRemove,
}: {
  snippet: Snippet;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        if (!confirmDelete) setConfirmDelete(false);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 6px",
        borderBottom: `1px solid ${theme.border}`,
        opacity: snippet.enabled ? 1 : 0.6,
        transition: "opacity 150ms ease",
      }}
    >
      {/* Trigger and expansion preview */}
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
            {snippet.trigger}
          </span>
          {!snippet.enabled && (
            <span
              style={{
                fontSize: 11,
                padding: "1px 6px",
                borderRadius: 4,
                background: theme.track,
                color: theme.textMuted,
              }}
            >
              Paused
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 13,
            color: theme.textMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 480,
          }}
          title={snippet.expansion}
        >
          {snippet.expansion.replace(/\n/g, " ↵ ")}
        </div>
      </div>

      {/* Action controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={snippet.enabled}
          onClick={onToggle}
          title={snippet.enabled ? "Disable snippet" : "Enable snippet"}
          style={{
            width: 34,
            height: 18,
            borderRadius: 9999,
            background: snippet.enabled ? theme.accent : theme.track,
            border: `1px solid ${snippet.enabled ? theme.accentDeep : theme.border}`,
            cursor: "pointer",
            position: "relative",
            transition: "background-color 150ms ease",
            padding: 0,
            outline: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 1,
              left: snippet.enabled ? 17 : 1,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
              transition: "left 150ms ease",
            }}
          />
        </button>

        {confirmDelete ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={onRemove}
              style={{
                border: "none",
                background: palette.error,
                color: "#fff",
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font.ui,
              }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{
                border: "none",
                background: theme.track,
                color: theme.textMuted,
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 11.5,
                cursor: "pointer",
                fontFamily: font.ui,
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: hover ? 1 : 0.35,
              transition: "opacity 120ms ease",
            }}
          >
            <button
              onClick={onEdit}
              title="Edit snippet"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: theme.textMuted,
                padding: 4,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="edit" size={15} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              title="Remove snippet"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: theme.textFaint,
                padding: 4,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SnippetsPane() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);

  const { error, clearError, run } = useAction();

  const load = () => run(async () => setSnippets(await getSnippets()));

  useEffect(() => {
    void load();
  }, []);

  const handleToggle = async (snippet: Snippet) => {
    const ok = await run(() =>
      updateSnippet(snippet.trigger, snippet.expansion, !snippet.enabled),
    );
    if (ok) await load();
  };

  const handleRemove = async (trigger: string) => {
    const ok = await run(() => removeSnippet(trigger));
    if (ok) await load();
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? snippets.filter(
        (s) =>
          s.trigger.toLowerCase().includes(q) || s.expansion.toLowerCase().includes(q),
      )
    : snippets;

  return (
    <div style={{ maxWidth: 760 }}>
      {error && <ActionError message={error} onDismiss={clearError} />}
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: font.serif,
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: -0.4,
              margin: 0,
              color: theme.textStrong,
            }}
          >
            Snippets
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 14, margin: "8px 0 0" }}>
            Save reusable phrases and expand them by voice during dictation.
          </p>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            setEditingSnippet(null);
            setAdding((a) => !a);
          }}
        >
          <Icon name="plus" size={15} style={{ color: "#fff" }} />
          Add snippet
        </Button>
      </div>

      {/* Search toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 9,
            padding: "6px 10px",
            minWidth: 220,
          }}
        >
          <Icon name="search" size={15} style={{ color: theme.textFaint }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search triggers or expansions"
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: font.ui,
              fontSize: 13,
              color: theme.textBody,
              width: "100%",
            }}
          />
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <SnippetForm
          onSave={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Edit form */}
      {editingSnippet && (
        <SnippetForm
          initial={editingSnippet}
          onSave={() => {
            setEditingSnippet(null);
            void load();
          }}
          onCancel={() => setEditingSnippet(null)}
        />
      )}

      {/* List card */}
      <Card pad={filtered.length ? 8 : 22}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "36px 16px",
              textAlign: "center",
              color: theme.textMuted,
              fontSize: 13.5,
              lineHeight: 1.6,
              maxWidth: 420,
              margin: "0 auto",
            }}
          >
            {snippets.length === 0 ? (
              <>
                <div style={{ fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
                  No snippets yet
                </div>
                <div>
                  Say “my signature” while dictating and the full sign-off is typed out.
                </div>
              </>
            ) : (
              `No snippets match “${query}”.`
            )}
          </div>
        ) : (
          <div style={{ padding: "4px 14px" }}>
            {filtered.map((s) => (
              <SnippetRow
                key={s.trigger}
                snippet={s}
                onToggle={() => void handleToggle(s)}
                onEdit={() => {
                  setAdding(false);
                  setEditingSnippet(s);
                }}
                onRemove={() => void handleRemove(s.trigger)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
