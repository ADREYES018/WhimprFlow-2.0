import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, Segmented } from "./ui";
import { ActionError, useAction } from "./useAction";
import { Icon } from "./icons";
import {
  getTransforms,
  addTransform,
  updateTransform,
  removeTransform,
  runTransform,
  type Transform,
  type TransformSource,
} from "./api";

const SOURCE_OPTIONS: { value: TransformSource; label: string }[] = [
  { value: "utterance", label: "Utterance" },
  { value: "selection", label: "Selection" },
  { value: "scratchpad", label: "Scratchpad" },
];

function TransformForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Transform;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [triggers, setTriggers] = useState<string[]>(initial?.triggers ?? []);
  const [newTrigger, setNewTrigger] = useState("");
  const [source, setSource] = useState<TransformSource>(initial?.default_source ?? "utterance");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
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

  const handleAddTrigger = () => {
    const trimmed = newTrigger.trim();
    if (!trimmed) return;
    if (!triggers.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setTriggers([...triggers, trimmed]);
    }
    setNewTrigger("");
  };

  const handleRemoveTrigger = (index: number) => {
    setTriggers(triggers.filter((_, i) => i !== index));
  };

  const { error, clearError, run } = useAction();

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt || saving) return;

    setSaving(true);
    const transformData: Transform = {
      id: initial?.id ?? `transform_${Date.now()}`,
      name: trimmedName,
      triggers,
      prompt: trimmedPrompt,
      default_source: source,
      builtin: initial?.builtin ?? false,
    };

    const ok = await run(() =>
      initial ? updateTransform(transformData) : addTransform(transformData),
    );
    setSaving(false);
    // Keep the form open on failure so the prompt text the user wrote survives.
    if (ok) onSave();
  };

  return (
    <Card style={{ marginBottom: 18, borderColor: theme.accentSoftBorder }}>
      {error && <ActionError message={error} onDismiss={clearError} />}
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 14 }}>
        {initial ? "Edit transform" : "Add a transform"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Transform Name */}
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Transform name
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Executive Summary"
            style={inputStyle}
          />
        </div>

        {/* Trigger phrases chip editor */}
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Trigger phrases <span style={{ color: theme.textFaint }}>(spoken commands that invoke this)</span>
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              placeholder="e.g. summarize this"
              style={{ ...inputStyle, flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTrigger();
                }
              }}
            />
            <Button variant="ghost" size="sm" onClick={handleAddTrigger} disabled={!newTrigger.trim()}>
              Add trigger
            </Button>
          </div>
          {triggers.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {triggers.map((trig, idx) => (
                <span
                  key={idx}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 8px",
                    background: theme.track,
                    borderRadius: 6,
                    fontSize: 12.5,
                    color: theme.textStrong,
                  }}
                >
                  {trig}
                  <button
                    type="button"
                    onClick={() => handleRemoveTrigger(idx)}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 0,
                      color: theme.textMuted,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: theme.textFaint }}>
              No triggers added yet. Add at least one trigger to run by voice.
            </div>
          )}
        </div>

        {/* Default source selector */}
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 6 }}>
            Default source
          </label>
          <Segmented<TransformSource>
            options={SOURCE_OPTIONS}
            value={source}
            onChange={setSource}
          />
        </div>

        {/* Prompt template */}
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Prompt template <span style={{ color: theme.textFaint }}>({"{input}"} is replaced by the source text)</span>
          </label>
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Summarize the following text into three bullet points:&#10;&#10;{input}"
            style={{
              ...inputStyle,
              resize: "vertical",
              lineHeight: 1.5,
              fontFamily: font.ui,
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button
          variant="accent"
          onClick={() => void handleSubmit()}
          disabled={saving || !name.trim() || !prompt.trim()}
        >
          {saving ? "Saving..." : initial ? "Save changes" : "Create transform"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function TransformRow({
  transform,
  onEdit,
  onDelete,
  onRunSelection,
  isRunning,
}: {
  transform: Transform;
  onEdit: () => void;
  onDelete: () => void;
  onRunSelection: () => void;
  isRunning: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sourceLabels: Record<TransformSource, string> = {
    utterance: "Utterance",
    selection: "Selection",
    scratchpad: "Scratchpad",
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        if (!confirmDelete) setConfirmDelete(false);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 8px",
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: theme.textStrong }}>
            {transform.name}
          </span>
          {transform.builtin && (
            <span
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 4,
                background: theme.accentSoft,
                color: theme.accentDeep,
                fontWeight: 600,
              }}
            >
              Built-in
            </span>
          )}
          <span
            style={{
              fontSize: 11.5,
              padding: "2px 7px",
              borderRadius: 4,
              background: theme.track,
              color: theme.textMuted,
            }}
          >
            Source: {sourceLabels[transform.default_source]}
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRunSelection}
            disabled={isRunning}
          >
            {isRunning ? "Running..." : "Run on selection"}
          </Button>

          {confirmDelete ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={onDelete}
                style={{
                  border: "none",
                  background: palette.error,
                  color: "#fff",
                  borderRadius: 6,
                  padding: "4px 8px",
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
                  padding: "4px 8px",
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
                title="Edit transform"
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
              {!transform.builtin && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Remove transform"
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
              )}
            </div>
          )}
        </div>
      </div>

      {/* Trigger chips */}
      {transform.triggers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {transform.triggers.map((trig, idx) => (
            <span
              key={idx}
              style={{
                fontSize: 12,
                padding: "2px 7px",
                borderRadius: 5,
                background: theme.cardBgSubtle,
                border: `1px solid ${theme.border}`,
                color: theme.textMuted,
              }}
            >
              “{trig}”
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TransformsPane() {
  const [transforms, setTransforms] = useState<Transform[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingTransform, setEditingTransform] = useState<Transform | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    transformName: string;
    output: string;
  } | null>(null);

  const { error, clearError, run } = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => run(async () => setTransforms(await getTransforms()));

  useEffect(() => {
    void load();
  }, []);

  const handleRunSelection = async (transform: Transform) => {
    setRunningId(transform.id);
    await run(async () => {
      const result = await runTransform(transform.id, "selection");
      setTestResult({
        transformName: transform.name,
        output: result || "Transform completed. No output was returned from selection.",
      });
    });
    setRunningId(null);
  };

  const handleDelete = async (id: string) => {
    setNotice(null);
    let removed = false;
    const ok = await run(async () => {
      removed = await removeTransform(id);
    });
    if (!ok) return;
    // The command returns false for a builtin. Without this the row simply
    // stayed put with no explanation, which reads as a broken button.
    if (!removed) {
      setNotice("Built-in transforms cannot be deleted. You can edit one instead.");
      return;
    }
    await load();
  };

  return (
    <div style={{ maxWidth: 800 }}>
      {error && <ActionError message={error} onDismiss={clearError} />}
      {notice && (
        <ActionError
          headline="Nothing was deleted."
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}
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
            Transforms
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 14, margin: "8px 0 0" }}>
            Turn a spoken thought into an email, a summary, or a to-do with one command.
          </p>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            setEditingTransform(null);
            setAdding((a) => !a);
          }}
        >
          <Icon name="plus" size={15} style={{ color: "#fff" }} />
          Add transform
        </Button>
      </div>

      {/* Test results panel if a transform was run on selection */}
      {testResult && (
        <Card
          pad={16}
          style={{
            marginBottom: 18,
            background: theme.cardBgSubtle,
            borderColor: theme.accentSoftBorder,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>
              Result for “{testResult.transformName}” on selection
            </div>
            <button
              onClick={() => setTestResult(null)}
              style={{
                border: "none",
                background: "transparent",
                color: theme.textMuted,
                cursor: "pointer",
                fontSize: 14,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: theme.textBody,
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: "10px 14px",
              whiteSpace: "pre-wrap",
            }}
          >
            {testResult.output}
          </div>
        </Card>
      )}

      {/* Add form */}
      {adding && (
        <TransformForm
          onSave={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Edit form */}
      {editingTransform && (
        <TransformForm
          initial={editingTransform}
          onSave={() => {
            setEditingTransform(null);
            void load();
          }}
          onCancel={() => setEditingTransform(null)}
        />
      )}

      {/* Transforms List */}
      <Card pad={transforms.length ? 8 : 22}>
        {transforms.length === 0 ? (
          <div
            style={{
              padding: "36px 16px",
              textAlign: "center",
              color: theme.textMuted,
              fontSize: 13.5,
              lineHeight: 1.6,
              maxWidth: 440,
              margin: "0 auto",
            }}
          >
            <div style={{ fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
              No transforms configured yet
            </div>
            <div>
              Say “summarize this” to convert bullet thoughts into a polished executive summary.
            </div>
          </div>
        ) : (
          <div style={{ padding: "4px 12px" }}>
            {transforms.map((t) => (
              <TransformRow
                key={t.id}
                transform={t}
                isRunning={runningId === t.id}
                onRunSelection={() => void handleRunSelection(t)}
                onEdit={() => {
                  setAdding(false);
                  setEditingTransform(t);
                }}
                onDelete={() => void handleDelete(t.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
