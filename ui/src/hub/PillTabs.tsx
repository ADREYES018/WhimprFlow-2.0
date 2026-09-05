import { useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";

export interface PillTabItem<K extends string = string> {
  key: K;
  label: string;
}

export interface PillTabsProps<K extends string = string> {
  items: PillTabItem<K>[];
  activeKey: K;
  onChange: (key: K) => void;
}

function PillButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => {
        try {
          if (e.currentTarget.matches(":focus-visible")) {
            setFocused(true);
          }
        } catch {
          setFocused(true);
        }
      }}
      onBlur={() => setFocused(false)}
      style={{
        border: "none",
        cursor: "pointer",
        borderRadius: 999,
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        fontFamily: font.ui,
        color: active ? "#ffffff" : theme.textMuted,
        background: active ? theme.accent : hover ? theme.hover : "transparent",
        transition: "background 120ms ease, color 120ms ease, box-shadow 120ms ease",
        whiteSpace: "nowrap",
        outline: "none",
        boxShadow: focused
          ? active
            ? `0 0 0 2px ${theme.cardBg}, 0 0 0 4px ${theme.accent}`
            : `0 0 0 2px ${theme.accent}`
          : undefined,
        lineHeight: 1.2,
      }}
    >
      {label}
    </button>
  );
}

export function PillTabs<K extends string = string>({
  items,
  activeKey,
  onChange,
}: PillTabsProps<K>) {
  if (items.length <= 1) return null;

  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: theme.cardBgSubtle,
        borderRadius: 14,
        padding: "4px",
        gap: 2,
      }}
    >
      {items.map((item) => (
        <PillButton
          key={item.key}
          label={item.label}
          active={item.key === activeKey}
          onClick={() => onChange(item.key)}
        />
      ))}
    </div>
  );
}
