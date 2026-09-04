import { useCallback, useState, type ReactNode } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";

// Mutations in the panes below cross into Rust, and a Tauri command can fail
// for reasons the user needs to know about: the store failed to write, the
// worker is down, a permission lapsed. Before this existed, every wrapper in
// api.ts caught its own errors and quietly fell back to an in-memory value, so
// a save that never reached disk still rendered as saved. Now the wrappers
// throw and this carries the failure to the screen.

/// Wrap an async mutation so a failure lands in the UI instead of in a silent
/// unhandled rejection. `run` resolves either way, so callers never need their
/// own try/catch.
export function useAction() {
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      setError(null);
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { error, clearError, run };
}

/// The inline strip a pane shows when its last action failed. Dismissible,
/// never a modal: a dialog in a Tauri webview blocks the whole event loop.
export function ActionError({
  message,
  onDismiss,
  headline = "That did not save.",
}: {
  message: string;
  onDismiss: () => void;
  /// Override for a strip that is not reporting a failed write.
  headline?: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 18,
        borderRadius: 10,
        background: "rgba(255,107,107,0.10)",
        border: "1px solid rgba(255,107,107,0.30)",
        fontFamily: font.ui,
      }}
    >
      <span style={{ fontSize: 14, flex: "0 0 auto" }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong }}>
          {headline}
        </span>
        <span style={{ fontSize: 13, color: theme.textMuted, marginLeft: 8 }}>{message}</span>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          flex: "0 0 auto",
          cursor: "pointer",
          border: "none",
          background: "transparent",
          color: theme.textFaint,
          fontSize: 14,
          padding: 4,
        }}
      >
        ✕
      </button>
    </div>
  );
}
