import { useEffect, useRef, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card } from "./ui";
import { ActionError, useAction } from "./useAction";
import {
  getScratchpad,
  setScratchpadText,
  setScratchpadCapture,
  getTransforms,
  runTransform,
  type Transform,
} from "./api";

export function ScratchpadPane() {
  const [text, setText] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [transforms, setTransforms] = useState<Transform[]>([]);
  const [selectedTransformId, setSelectedTransformId] = useState("");
  const [undoText, setUndoText] = useState<string | null>(null);
  const [runningTransform, setRunningTransform] = useState(false);
  const [copied, setCopied] = useState(false);

  const initialLoadRef = useRef(true);
  const { error, clearError, run } = useAction();

  useEffect(() => {
    let active = true;
    void run(async () => {
      const [pad, tList] = await Promise.all([getScratchpad(), getTransforms()]);
      if (!active) return;
      setText(pad.text);
      setCaptureMode(pad.capture_mode);
      setTransforms(tList);
      if (tList.length > 0) {
        setSelectedTransformId(tList[0].id);
      }
      setIsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Autosave with 500 ms debounce
  useEffect(() => {
    if (!isLoaded) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }

    setIsSaving(true);
    const timer = setTimeout(() => {
      void run(() => setScratchpadText(text)).finally(() => setIsSaving(false));
    }, 500);

    return () => clearTimeout(timer);
  }, [text, isLoaded]);

  const handleToggleCapture = async () => {
    const next = !captureMode;
    const ok = await run(() => setScratchpadCapture(next));
    if (ok) setCaptureMode(next);
  };

  const handleRunTransform = async () => {
    if (!selectedTransformId || runningTransform) return;
    setRunningTransform(true);
    await run(async () => {
      const res = await runTransform(selectedTransformId, "scratchpad");
      if (res) {
        setUndoText(text);
        setText(res);
        await setScratchpadText(res);
      }
    });
    setRunningTransform(false);
  };

  const handleUndo = async () => {
    if (undoText === null) return;
    const restored = undoText;
    setUndoText(null);
    setText(restored);
    await run(() => setScratchpadText(restored));
  };

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      // A denied clipboard write used to leave the button doing nothing at all,
      // which reads as a dead control.
      await run(() => Promise.reject(e));
    }
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  return (
    <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 16 }}>
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
          Scratchpad
        </h1>
        <p style={{ color: theme.textMuted, fontSize: 14, margin: "8px 0 0" }}>
          A quiet place to dictate long-form text before moving it elsewhere.
        </p>
      </div>

      {/* Control bar: Capture mode & Transforms */}
      <Card pad={14} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Capture mode toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              role="switch"
              aria-checked={captureMode}
              onClick={() => void handleToggleCapture()}
              style={{
                width: 38,
                height: 22,
                borderRadius: 9999,
                background: captureMode ? theme.accent : theme.track,
                border: `1px solid ${captureMode ? theme.accentDeep : theme.border}`,
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
                  left: captureMode ? 18 : 2,
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
                Capture mode
              </span>
              <span style={{ fontSize: 12.5, color: theme.textMuted, marginLeft: 8 }}>
                {captureMode
                  ? "Dictation writes directly into this scratchpad instead of the active app."
                  : "Dictation writes to your cursor in whichever app is focused."}
              </span>
            </div>
          </div>

          {/* Autosave badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: isSaving ? palette.warn : palette.success,
              }}
            />
            <span style={{ fontSize: 12, color: theme.textMuted }}>
              {isSaving ? "Saving..." : "Saved"}
            </span>
          </div>
        </div>

        {/* Transform action row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 10,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: theme.textMuted, fontWeight: 500 }}>
              Transform:
            </span>
            <select
              value={selectedTransformId}
              onChange={(e) => setSelectedTransformId(e.target.value)}
              disabled={transforms.length === 0 || runningTransform}
              style={{
                background: theme.cardBgSubtle,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                padding: "5px 10px",
                fontSize: 12.5,
                fontFamily: font.ui,
                color: theme.textStrong,
                outline: "none",
                cursor: transforms.length === 0 ? "default" : "pointer",
              }}
            >
              {transforms.length === 0 ? (
                <option value="">No transforms available</option>
              ) : (
                transforms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))
              )}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleRunTransform()}
              disabled={!selectedTransformId || runningTransform}
            >
              {runningTransform ? "Running..." : "Run"}
            </Button>
            {undoText !== null && (
              <Button variant="ghost" size="sm" onClick={() => void handleUndo()}>
                Undo transform
              </Button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => void handleCopy()} disabled={!text}>
              {copied ? "Copied" : "Copy text"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Writing surface */}
      <Card
        pad={20}
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 460,
          background: theme.cardBg,
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Start dictating or type here. Shape long thoughts at your own pace before pasting them into emails, notes, or tickets."
          style={{
            width: "100%",
            flex: 1,
            minHeight: 400,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            fontFamily: font.ui,
            fontSize: 15,
            lineHeight: 1.7,
            color: theme.textStrong,
            padding: 0,
            boxSizing: "border-box",
          }}
        />

        {/* Footer info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 12,
            marginTop: 12,
            fontSize: 12.5,
            color: theme.textMuted,
          }}
        >
          <div>
            <span>
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
            <span style={{ margin: "0 6px" }}>·</span>
            <span>
              {charCount} {charCount === 1 ? "character" : "characters"}
            </span>
          </div>
          {undoText !== null && (
            <span style={{ color: theme.accentDeep, fontWeight: 500 }}>
              Transform applied. Click Undo above to revert.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
