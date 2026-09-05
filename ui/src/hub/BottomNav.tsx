import { useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Icon, type IconName } from "./icons";

export type Page =
  | "home"
  | "meetings"
  | "library"
  | "insights"
  | "dictionary"
  | "snippets"
  | "style"
  | "transforms"
  | "scratchpad"
  | "settings"
  | "help";

export const BOTTOM_NAV_HEIGHT = 56;
export const BOTTOM_NAV_GAP = 20;
export const BOTTOM_NAV_BREATHING = 20;
export const MAIN_BOTTOM_PAD = BOTTOM_NAV_HEIGHT + BOTTOM_NAV_GAP + BOTTOM_NAV_BREATHING;

export type NavGroupKey = "home" | "notes" | "flow" | "settings";

export interface NavChildDef {
  key: Page;
  label: string;
}

export interface NavGroupDef {
  key: NavGroupKey;
  label: string;
  icon: IconName;
  children: NavChildDef[];
}

export const NAV_GROUPS: NavGroupDef[] = [
  {
    key: "home",
    label: "Home",
    icon: "home",
    children: [{ key: "home", label: "Home" }],
  },
  {
    key: "notes",
    label: "Notes",
    icon: "meetings",
    children: [
      { key: "meetings", label: "Meetings" },
      { key: "library", label: "Library" },
      { key: "insights", label: "Insights" },
    ],
  },
  {
    key: "flow",
    label: "Flow",
    icon: "mic",
    children: [
      { key: "scratchpad", label: "Scratchpad" },
      { key: "snippets", label: "Snippets" },
      { key: "style", label: "Style" },
      { key: "transforms", label: "Transforms" },
      { key: "dictionary", label: "Dictionary" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    icon: "settings",
    children: [
      { key: "settings", label: "Settings" },
      { key: "help", label: "Help" },
    ],
  },
];

function NavButton({
  group,
  active,
  onClick,
}: {
  group: NavGroupDef;
  active: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);

  const showTooltip = hover || focused;

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      {showTooltip && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: theme.bannerVia,
            color: "#ffffff",
            fontFamily: font.ui,
            fontSize: 11.5,
            fontWeight: 500,
            padding: "4px 8px",
            borderRadius: 6,
            boxShadow: theme.shadow,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 60,
          }}
        >
          {group.label}
        </div>
      )}
      <button
        type="button"
        title={group.label}
        aria-label={group.label}
        aria-current={active ? "page" : undefined}
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
        onBlur={() => {
          setFocused(false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 12,
          border: "none",
          cursor: "pointer",
          background: active ? theme.accentSoft : hover ? theme.hover : "transparent",
          transition: "background 120ms ease, color 120ms ease, box-shadow 120ms ease",
          outline: "none",
          boxShadow: focused ? `0 0 0 2px ${theme.accent}` : undefined,
          padding: 0,
        }}
      >
        <Icon
          name={group.icon}
          size={20}
          style={{
            color: active ? theme.accentDeep : theme.textMuted,
            transition: "color 120ms ease",
          }}
        />
      </button>
    </div>
  );
}

export interface BottomNavProps {
  activeGroup: NavGroupKey;
  onSelectGroup: (group: NavGroupKey) => void;
}

export function BottomNav({ activeGroup, onSelectGroup }: BottomNavProps) {
  return (
    <nav
      aria-label="Bottom Navigation"
      style={{
        position: "fixed",
        bottom: BOTTOM_NAV_GAP,
        left: "50%",
        transform: "translateX(-50%)",
        height: BOTTOM_NAV_HEIGHT,
        boxSizing: "border-box",
        borderRadius: 20,
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
        boxShadow: theme.shadowHover,
        display: "flex",
        alignItems: "center",
        padding: "0 6px",
        gap: 4,
        zIndex: 50,
      }}
    >
      {NAV_GROUPS.map((group) => (
        <NavButton
          key={group.key}
          group={group}
          active={group.key === activeGroup}
          onClick={() => onSelectGroup(group.key)}
        />
      ))}
    </nav>
  );
}
