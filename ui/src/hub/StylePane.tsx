import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card } from "./ui";
import { ActionError, useAction } from "./useAction";
import { Icon } from "./icons";
import {
  DERIVE_EVERY,
  getStyle,
  addStyleSample,
  removeStyleSample,
  deriveStyleProfile,
  setStyleProfile,
  setStyleContext,
  removeStyleContext,
  setStyleAutoLearn,
  acceptPendingStyle,
  discardPendingStyle,
  type StyleStore,
  type StyleProfile,
  type StyleContext,
} from "./api";

const REDERIVE_THRESHOLD = DERIVE_EVERY;

const DEFAULT_PROFILE: StyleProfile = {
  avg_sentence_words: 14,
  contractions: true,
  punctuation_notes: "Use commas for natural pauses. Avoid run-on sentences.",
  banned_words: [],
  tone_notes: "Direct, clear, and professional.",
  derived_at: Date.now(),
};

function ProfileEditor({
  initial,
  onSave,
  saveLabel = "Save profile",
}: {
  initial: StyleProfile;
  onSave: (p: StyleProfile) => Promise<void> | void;
  saveLabel?: string;
}) {
  const [avgWords, setAvgWords] = useState(initial.avg_sentence_words || 14);
  const [contractions, setContractions] = useState(initial.contractions ?? true);
  const [punctNotes, setPunctNotes] = useState(initial.punctuation_notes || "");
  const [toneNotes, setToneNotes] = useState(initial.tone_notes || "");
  const [bannedWords, setBannedWords] = useState<string[]>(initial.banned_words || []);
  const [newBannedWord, setNewBannedWord] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedBadge, setSavedBadge] = useState(false);

  useEffect(() => {
    setAvgWords(initial.avg_sentence_words || 14);
    setContractions(initial.contractions ?? true);
    setPunctNotes(initial.punctuation_notes || "");
    setToneNotes(initial.tone_notes || "");
    setBannedWords(initial.banned_words || []);
  }, [initial]);

  const inputStyle = {
    width: "100%",
    background: theme.cardBgSubtle,
    border: `1px solid ${theme.border}`,
    borderRadius: 9,
    padding: "8px 12px",
    color: theme.textBody,
    fontFamily: font.ui,
    fontSize: 13.5,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  const handleAddBannedWord = () => {
    const trimmed = newBannedWord.trim().toLowerCase();
    if (!trimmed) return;
    if (!bannedWords.includes(trimmed)) {
      setBannedWords([...bannedWords, trimmed]);
    }
    setNewBannedWord("");
  };

  const handleRemoveBannedWord = (word: string) => {
    setBannedWords(bannedWords.filter((w) => w !== word));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated: StyleProfile = {
        avg_sentence_words: Number(avgWords) || 14,
        contractions,
        punctuation_notes: punctNotes.trim(),
        banned_words: bannedWords,
        tone_notes: toneNotes.trim(),
        derived_at: Date.now(),
      };
      await onSave(updated);
      setSavedBadge(true);
      setTimeout(() => setSavedBadge(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Row: Avg sentence words & Contractions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Average words per sentence
          </label>
          <input
            type="number"
            min={4}
            max={60}
            value={avgWords}
            onChange={(e) => setAvgWords(Number(e.target.value))}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Contractions
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, height: 38 }}>
            <button
              type="button"
              role="switch"
              aria-checked={contractions}
              onClick={() => setContractions(!contractions)}
              style={{
                width: 38,
                height: 22,
                borderRadius: 9999,
                background: contractions ? theme.accent : theme.track,
                border: `1px solid ${contractions ? theme.accentDeep : theme.border}`,
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
                  top: 2,
                  left: contractions ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  transition: "left 150ms ease",
                }}
              />
            </button>
            <span style={{ fontSize: 13, color: theme.textStrong }}>
              {contractions ? "Allowed (don't, can't, it's)" : "Avoided (do not, cannot, it is)"}
            </span>
          </div>
        </div>
      </div>

      {/* Punctuation guidelines */}
      <div>
        <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
          Punctuation guidelines
        </label>
        <textarea
          rows={2}
          value={punctNotes}
          onChange={(e) => setPunctNotes(e.target.value)}
          placeholder="e.g. Use commas for natural pauses. Prefer short, crisp clauses."
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      {/* Tone guidelines */}
      <div>
        <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
          Tone guidelines
        </label>
        <textarea
          rows={2}
          value={toneNotes}
          onChange={(e) => setToneNotes(e.target.value)}
          placeholder="e.g. Direct, conversational, and precise. No buzzwords."
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      {/* Banned words chip editor */}
      <div>
        <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
          Banned words <span style={{ color: theme.textFaint }}>(words to avoid or strip during cleanup)</span>
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={newBannedWord}
            onChange={(e) => setNewBannedWord(e.target.value)}
            placeholder="e.g. synergy"
            style={{ ...inputStyle, flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddBannedWord();
              }
            }}
          />
          <Button variant="ghost" size="sm" onClick={handleAddBannedWord} disabled={!newBannedWord.trim()}>
            Add word
          </Button>
        </div>
        {bannedWords.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {bannedWords.map((w) => (
              <span
                key={w}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: theme.track,
                  color: theme.textStrong,
                  fontSize: 12,
                }}
              >
                {w}
                <button
                  type="button"
                  onClick={() => handleRemoveBannedWord(w)}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    color: theme.textMuted,
                    fontSize: 11,
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Save action */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <Button variant="accent" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : saveLabel}
        </Button>
        {savedBadge && (
          <span style={{ fontSize: 12.5, color: palette.success, fontWeight: 600 }}>
            Profile saved
          </span>
        )}
      </div>
    </div>
  );
}

function PendingDiffCard({
  base,
  pending,
  onAccept,
  onDiscard,
}: {
  base: StyleProfile | null;
  pending: StyleProfile;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const fields: {
    label: string;
    oldVal: string;
    newVal: string;
  }[] = [
    {
      label: "Sentence length",
      oldVal: base ? `${base.avg_sentence_words} words` : "None",
      newVal: `${pending.avg_sentence_words} words`,
    },
    {
      label: "Contractions",
      oldVal: base ? (base.contractions ? "Allowed" : "Avoided") : "None",
      newVal: pending.contractions ? "Allowed" : "Avoided",
    },
    {
      label: "Punctuation notes",
      oldVal: base?.punctuation_notes || "None",
      newVal: pending.punctuation_notes || "None",
    },
    {
      label: "Tone notes",
      oldVal: base?.tone_notes || "None",
      newVal: pending.tone_notes || "None",
    },
    {
      label: "Banned words",
      oldVal: base?.banned_words.length ? base.banned_words.join(", ") : "None",
      newVal: pending.banned_words.length ? pending.banned_words.join(", ") : "None",
    },
  ];

  return (
    <Card
      pad={18}
      style={{
        marginBottom: 24,
        background: theme.cardBgSubtle,
        borderColor: theme.accentSoftBorder,
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.textStrong }}>
            Proposed style refinement
          </div>
          <p style={{ color: theme.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            Derived from recent dictations. Review proposed changes against your current profile.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="accent" size="sm" onClick={onAccept}>
            Accept update
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {fields.map((f) => {
          const changed = f.oldVal !== f.newVal;
          return (
            <div
              key={f.label}
              style={{
                display: "grid",
                gridTemplateColumns: "150px 1fr 1fr",
                gap: 12,
                padding: "8px 10px",
                borderRadius: 8,
                background: changed ? "rgba(0,113,227,0.06)" : "transparent",
                borderBottom: `1px solid ${theme.border}`,
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, color: theme.textStrong }}>{f.label}</span>
              <span style={{ color: theme.textMuted }}>Current: {f.oldVal}</span>
              <span style={{ color: changed ? theme.accentDeep : theme.textBody, fontWeight: changed ? 600 : 400 }}>
                Proposed: {f.newVal}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ContextCard({
  context,
  onSave,
  onDelete,
}: {
  context: StyleContext;
  onSave: (c: StyleContext) => Promise<void>;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(context.name);
  const [bundleIds, setBundleIds] = useState<string[]>(context.bundle_ids || []);
  const [newBundle, setNewBundle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleAddBundle = () => {
    const trimmed = newBundle.trim();
    if (!trimmed) return;
    if (!bundleIds.includes(trimmed)) {
      setBundleIds([...bundleIds, trimmed]);
    }
    setNewBundle("");
  };

  const handleRemoveBundle = (b: string) => {
    setBundleIds(bundleIds.filter((item) => item !== b));
  };

  const handleSaveAll = async (updatedProfile: StyleProfile) => {
    await onSave({
      id: context.id,
      name: name.trim() || context.name,
      bundle_ids: bundleIds,
      profile: updatedProfile,
    });
    setExpanded(false);
  };

  return (
    <div
      style={{
        padding: "14px 10px",
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: theme.textStrong }}>
              {context.name}
            </span>
            {context.bundle_ids.map((bid) => (
              <span
                key={bid}
                style={{
                  fontSize: 11.5,
                  padding: "2px 7px",
                  borderRadius: 5,
                  background: theme.track,
                  color: theme.textMuted,
                  fontFamily: font.mono,
                }}
              >
                {bid}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Close" : "Edit context"}
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
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete context"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: theme.textFaint,
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            background: theme.cardBgSubtle,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
                Context name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: "100%",
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontSize: 13,
                  fontFamily: font.ui,
                  color: theme.textStrong,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
                App bundle IDs <span style={{ color: theme.textFaint }}>(comma or enter separated, e.g. com.apple.mail)</span>
              </label>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input
                  value={newBundle}
                  onChange={(e) => setNewBundle(e.target.value)}
                  placeholder="e.g. com.apple.mail"
                  style={{
                    flex: 1,
                    background: theme.cardBg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 13,
                    fontFamily: font.mono,
                    color: theme.textStrong,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddBundle();
                    }
                  }}
                />
                <Button variant="ghost" size="sm" onClick={handleAddBundle} disabled={!newBundle.trim()}>
                  Add ID
                </Button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {bundleIds.map((bid) => (
                  <span
                    key={bid}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 7px",
                      borderRadius: 5,
                      background: theme.track,
                      fontSize: 11.5,
                      fontFamily: font.mono,
                    }}
                  >
                    {bid}
                    <button
                      type="button"
                      onClick={() => handleRemoveBundle(bid)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        padding: 0,
                        color: theme.textMuted,
                        fontSize: 10,
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong, marginBottom: 10 }}>
              Override profile
            </div>
            <ProfileEditor
              initial={context.profile}
              saveLabel="Save context profile"
              onSave={handleSaveAll}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function StylePane() {
  const [store, setStore] = useState<StyleStore | null>(null);
  const [newSample, setNewSample] = useState("");
  const [addingContext, setAddingContext] = useState(false);
  const [newContextName, setNewContextName] = useState("");
  const [newContextBundles, setNewContextBundles] = useState("");
  const [deriving, setDeriving] = useState(false);
  const [confirmSampleDeleteIdx, setConfirmSampleDeleteIdx] = useState<number | null>(null);

  const { error, clearError, run } = useAction();

  const load = () => run(async () => setStore(await getStyle()));

  useEffect(() => {
    void load();
  }, []);

  const handleSaveBaseProfile = async (profile: StyleProfile) => {
    if (await run(() => setStyleProfile(profile))) await load();
  };

  const handleAddSample = async () => {
    const text = newSample.trim();
    if (!text) return;
    if (!(await run(() => addStyleSample(text)))) return;
    setNewSample("");
    await load();
  };

  const handleRemoveSample = async (idx: number) => {
    if (!(await run(() => removeStyleSample(idx)))) return;
    setConfirmSampleDeleteIdx(null);
    await load();
  };

  const handleDerive = async () => {
    if (!store || store.samples.length === 0 || deriving) return;
    setDeriving(true);
    const ok = await run(() => deriveStyleProfile());
    setDeriving(false);
    if (ok) await load();
  };

  const handleToggleAutoLearn = async () => {
    if (!store) return;
    const next = !store.auto_learn;
    if (await run(() => setStyleAutoLearn(next))) await load();
  };

  const handleAcceptPending = async () => {
    if (await run(() => acceptPendingStyle())) await load();
  };

  const handleDiscardPending = async () => {
    if (await run(() => discardPendingStyle())) await load();
  };

  const handleCreateContext = async () => {
    const name = newContextName.trim();
    if (!name) return;
    const bids = newContextBundles
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const newCtx: StyleContext = {
      id: `ctx_${Date.now()}`,
      name,
      bundle_ids: bids,
      profile: store?.base ? { ...store.base } : { ...DEFAULT_PROFILE },
    };

    if (!(await run(() => setStyleContext(newCtx)))) return;
    setNewContextName("");
    setNewContextBundles("");
    setAddingContext(false);
    await load();
  };

  const handleSaveContext = async (ctx: StyleContext) => {
    if (await run(() => setStyleContext(ctx))) await load();
  };

  const handleRemoveContext = async (id: string) => {
    if (await run(() => removeStyleContext(id))) await load();
  };

  if (!store) {
    return error ? (
      <div style={{ maxWidth: 820 }}>
        <ActionError
          headline="Style settings could not be loaded."
          message={error}
          onDismiss={clearError}
        />
      </div>
    ) : null;
  }

  const progress = Math.min(store.dictations_since_derive, REDERIVE_THRESHOLD);
  const progressPercent = Math.round((progress / REDERIVE_THRESHOLD) * 100);

  return (
    <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 24 }}>
      {error && <ActionError message={error} onDismiss={clearError} />}
      {/* Header */}
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
          Style
        </h1>
        <p style={{ color: theme.textMuted, fontSize: 14, margin: "8px 0 0" }}>
          Tune how WhimprFlow formats and cleans spoken text to match your natural voice.
        </p>
      </div>

      {/* 1. Pending update (Rendered ONLY when pending is not null) */}
      {store.pending && (
        <PendingDiffCard
          base={store.base}
          pending={store.pending}
          onAccept={() => void handleAcceptPending()}
          onDiscard={() => void handleDiscardPending()}
        />
      )}

      {/* 2. Base profile */}
      <Card pad={20}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.textStrong }}>
            Base profile
          </div>
          <p style={{ color: theme.textMuted, fontSize: 13.5, margin: "4px 0 0" }}>
            The global voice and formatting rules applied across all apps.
          </p>
        </div>

        {store.base === null ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
              No base profile established yet
            </div>
            <p
              style={{
                fontSize: 13,
                color: theme.textMuted,
                maxWidth: 460,
                margin: "0 auto 14px",
                lineHeight: 1.5,
              }}
            >
              Add writing samples below and derive a profile, or initialize a clean baseline profile now.
            </p>
            <Button
              variant="accent"
              size="sm"
              onClick={() => void handleSaveBaseProfile(DEFAULT_PROFILE)}
            >
              Initialize baseline profile
            </Button>
          </div>
        ) : (
          <ProfileEditor initial={store.base} onSave={handleSaveBaseProfile} />
        )}
      </Card>

      {/* 3. Contexts */}
      <Card pad={20}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 16,
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: theme.textStrong }}>
              Contexts
            </div>
            <p style={{ color: theme.textMuted, fontSize: 13.5, margin: "4px 0 0" }}>
              The register for a client email is not the register for a note to yourself.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddingContext(!addingContext)}
          >
            {addingContext ? "Cancel" : "Add context"}
          </Button>
        </div>

        {addingContext && (
          <Card
            pad={14}
            style={{
              marginBottom: 16,
              background: theme.cardBgSubtle,
              borderColor: theme.accentSoftBorder,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong, marginBottom: 10 }}>
              New app context
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 4 }}>
                  Context name
                </label>
                <input
                  value={newContextName}
                  onChange={(e) => setNewContextName(e.target.value)}
                  placeholder="e.g. Work Mail"
                  style={{
                    width: "100%",
                    background: theme.cardBg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 13,
                    fontFamily: font.ui,
                    color: theme.textStrong,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 4 }}>
                  Bundle IDs <span style={{ color: theme.textFaint }}>(comma separated)</span>
                </label>
                <input
                  value={newContextBundles}
                  onChange={(e) => setNewContextBundles(e.target.value)}
                  placeholder="e.g. com.apple.mail, com.microsoft.Outlook"
                  style={{
                    width: "100%",
                    background: theme.cardBg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 13,
                    fontFamily: font.mono,
                    color: theme.textStrong,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button
                variant="accent"
                size="sm"
                onClick={() => void handleCreateContext()}
                disabled={!newContextName.trim()}
              >
                Create context
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAddingContext(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {store.contexts.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: theme.textMuted,
              fontSize: 13,
            }}
          >
            No app contexts configured yet. Add a context to apply specialized voice rules in apps like Slack or Mail.
          </div>
        ) : (
          <div>
            {store.contexts.map((ctx) => (
              <ContextCard
                key={ctx.id}
                context={ctx}
                onSave={handleSaveContext}
                onDelete={() => void handleRemoveContext(ctx.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* 4. Samples and auto-learn */}
      <Card pad={20}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.textStrong }}>
            Samples and auto-learn
          </div>
          <p style={{ color: theme.textMuted, fontSize: 13.5, margin: "4px 0 0" }}>
            Paste writing samples you produced to train the cleanup model, or allow auto-learning.
          </p>
        </div>

        {/* Existing samples list */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 6 }}>
            Saved writing samples ({store.samples.length})
          </label>
          {store.samples.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                background: theme.cardBgSubtle,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                fontSize: 13,
                color: theme.textMuted,
                textAlign: "center",
              }}
            >
              No samples added yet. Paste a past article, email, or report to train your profile.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {store.samples.map((samp, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    background: theme.cardBgSubtle,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: theme.textBody,
                      maxHeight: 46,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      flex: 1,
                    }}
                  >
                    {samp}
                  </div>
                  {confirmSampleDeleteIdx === idx ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => void handleRemoveSample(idx)}
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
                        onClick={() => setConfirmSampleDeleteIdx(null)}
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
                    <button
                      onClick={() => setConfirmSampleDeleteIdx(idx)}
                      title="Remove sample"
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: theme.textFaint,
                        padding: 2,
                        display: "flex",
                        alignItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add sample input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
            Add writing sample
          </label>
          <textarea
            rows={3}
            value={newSample}
            onChange={(e) => setNewSample(e.target.value)}
            placeholder="Paste writing that sounds like you..."
            style={{
              width: "100%",
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.border}`,
              borderRadius: 9,
              padding: "8px 12px",
              color: theme.textBody,
              fontFamily: font.ui,
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <div style={{ marginTop: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleAddSample()}
              disabled={!newSample.trim()}
            >
              Add sample
            </Button>
          </div>
        </div>

        {/* Derive button */}
        <div
          style={{
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 16,
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <Button
              variant="accent"
              size="sm"
              onClick={() => void handleDerive()}
              disabled={store.samples.length === 0 || deriving}
            >
              {deriving ? "Analyzing samples..." : "Derive from samples"}
            </Button>
            {store.samples.length === 0 && (
              <span style={{ fontSize: 12, color: theme.textMuted, marginLeft: 10 }}>
                Requires at least one sample above.
              </span>
            )}
          </div>
        </div>

        {/* Auto-learn toggle & progress */}
        <div
          style={{
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                role="switch"
                aria-checked={store.auto_learn}
                onClick={() => void handleToggleAutoLearn()}
                style={{
                  width: 38,
                  height: 22,
                  borderRadius: 9999,
                  background: store.auto_learn ? theme.accent : theme.track,
                  border: `1px solid ${store.auto_learn ? theme.accentDeep : theme.border}`,
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
                    top: 2,
                    left: store.auto_learn ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                    transition: "left 150ms ease",
                  }}
                />
              </button>
              <div>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>
                  Auto-learn from dictations
                </span>
                <span style={{ fontSize: 12.5, color: theme.textMuted, marginLeft: 8 }}>
                  Refines your profile automatically as you accept dictation outputs.
                </span>
              </div>
            </div>
          </div>

          {/* Progress bar towards re-derive threshold */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: theme.textMuted,
                marginBottom: 6,
              }}
            >
              <span>Progress toward automatic refinement</span>
              <span>
                {progress} / {REDERIVE_THRESHOLD} accepted dictations
              </span>
            </div>
            <div
              style={{
                width: "100%",
                height: 6,
                borderRadius: 3,
                background: theme.track,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: theme.accent,
                  transition: "width 200ms ease",
                }}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
