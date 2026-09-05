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

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
        transition: "background 120ms ease, color 120ms ease",
        whiteSpace: "nowrap",
        outline: "none",
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
