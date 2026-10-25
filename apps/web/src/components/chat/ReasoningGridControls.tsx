import {
  REASONING_COLUMN_LABELS,
  type ReasoningColumn,
  type SpeedTier,
} from "@t3tools/client-runtime/model-reasoning-grid";
import type { ProviderDriverKind } from "@t3tools/contracts";
import { ZapIcon } from "lucide-react";
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { cn } from "~/lib/utils";
import { UltrafastIcon } from "../Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { providerTextColor } from "./ProviderInstanceIcon";

export const SPEED_TIER_LABELS: Readonly<Record<SpeedTier, string>> = {
  standard: "Standard",
  fast: "Fast",
  ultrafast: "Ultrafast",
};

const SPEED_COLUMN_LABELS: Readonly<Record<SpeedTier, string>> = {
  standard: "Std",
  fast: "Fast",
  ultrafast: "Ultra",
};

function SpeedDivider() {
  return <span aria-hidden="true" className="mx-1.5 my-1 w-px self-stretch bg-border" />;
}

export function ReasoningColumnHeader(props: {
  columns: ReadonlyArray<ReasoningColumn>;
  speedColumns: ReadonlyArray<SpeedTier>;
}) {
  const label = "text-center text-3xs leading-tight text-muted-foreground/80";
  return (
    // Right padding matches the list's wrapper, list, and row padding so labels sit over their dots.
    <div
      aria-hidden="true"
      className="scrollbar-gutter-stable flex shrink-0 justify-end overflow-hidden pt-1 pr-1.5 pl-2"
    >
      <div className="flex px-2">
        {props.columns.map((column) => (
          <span key={column} className={cn("w-8", label)}>
            {REASONING_COLUMN_LABELS[column].shortLabel}
          </span>
        ))}
        {props.speedColumns.length > 0 ? (
          <>
            <span className="mx-1.5 w-px" />
            {props.speedColumns.map((tier) => (
              <span key={tier} className={cn("w-7", label)}>
                {SPEED_COLUMN_LABELS[tier]}
              </span>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

const LEVEL_FOCUS_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

function focusAdjacentLevel(event: KeyboardEvent<HTMLButtonElement>) {
  const levels = Array.from(
    event.currentTarget
      .closest("[data-reasoning-row]")
      ?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
  );
  const index = levels.indexOf(event.currentTarget);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? levels.length - 1
        : index + (event.key === "ArrowRight" ? 1 : -1);
  levels[Math.min(Math.max(next, 0), levels.length - 1)]?.focus();
}

function handleCellKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  if (LEVEL_FOCUS_KEYS.has(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    focusAdjacentLevel(event);
  } else if (event.key === "Enter" || event.key === " ") {
    // The button's click chooses; the row must not also select.
    event.stopPropagation();
  }
}

/** Middle- and right-clicks choose without closing the picker. */
function keepOpenClickHandlers(choose: () => void) {
  const handle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    choose();
  };
  return {
    // Stops Windows and Linux autoscroll from starting on a middle press.
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button === 1) event.preventDefault();
    },
    onAuxClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button === 1) handle(event);
    },
    onContextMenu: handle,
  };
}

/** Ties keep the level the drag is already on. */
function levelAtPointer(
  event: PointerEvent<HTMLButtonElement>,
  columns: ReadonlyArray<ReasoningColumn>,
  levels: ReadonlyArray<ReasoningColumn>,
  previous: ReasoningColumn,
): ReasoningColumn {
  const row = event.currentTarget.parentElement?.getBoundingClientRect();
  if (!row || row.width === 0) return previous;
  // In column units, where column i is centered at i.
  const position = ((event.clientX - row.left) / row.width) * columns.length - 0.5;
  let nearest = previous;
  let nearestDistance = Math.abs(columns.indexOf(previous) - position);
  for (const level of levels) {
    const distance = Math.abs(columns.indexOf(level) - position);
    if (distance < nearestDistance) {
      nearest = level;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export const ModelReasoningCells = memo(function ModelReasoningCells(props: {
  rowKey: string;
  modelName: string;
  driverKind: ProviderDriverKind;
  columns: ReadonlyArray<ReasoningColumn>;
  /** This model's levels among `columns`. */
  levels: ReadonlyArray<ReasoningColumn>;
  current: ReasoningColumn | null;
  isActive: boolean;
  disabled: boolean;
  /** Explains a lock that applies to the levels only, not the whole row. */
  lockReason: string | null;
  speedColumns: ReadonlyArray<SpeedTier>;
  /** This model's speeds among `speedColumns`. */
  speedTiers: ReadonlyArray<SpeedTier>;
  speedCurrent: SpeedTier | null;
  onChoose: (column: ReasoningColumn, keepOpen: boolean) => void;
  onChooseSpeed: (tier: SpeedTier, keepOpen: boolean) => void;
}) {
  const { columns, levels, current } = props;
  // The tab stop follows focus, so Tab leaves the row from whichever level the arrows reached.
  const [focused, setFocused] = useState<ReasoningColumn | null>(null);
  const [dragged, setDragged] = useState<ReasoningColumn | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    start: ReasoningColumn;
    column: ReasoningColumn;
    chosen: boolean;
  } | null>(null);
  if (columns.length === 0 && props.speedColumns.length === 0) return null;
  const shown = dragged ?? (props.isActive ? current : null);
  const shownIndex = shown === null ? -1 : columns.indexOf(shown);
  const tabStop =
    focused !== null && levels.includes(focused)
      ? focused
      : current !== null && levels.includes(current)
        ? current
        : levels[0];
  const accent = providerTextColor(props.driverKind);
  const disabled = props.disabled || props.lockReason !== null;
  // Without usable levels, Tab lands on the speed instead.
  const speedTabStop =
    disabled || levels.length === 0 ? (props.speedCurrent ?? props.speedTiers[0]) : undefined;

  const levelCells = (
    <div className="relative flex">
      {shownIndex >= 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0.5 left-1 rounded-full bg-current"
          style={{ width: `calc(${shownIndex * 8 + 6} * var(--spacing))` }}
        />
      ) : null}
      {columns.map((column, index) => {
        const label = REASONING_COLUMN_LABELS[column].label;
        if (!levels.includes(column)) {
          return <span key={column} aria-hidden="true" className="h-7 w-8" />;
        }
        const isCurrent = current === column;
        const filled = index <= shownIndex;
        return (
          <button
            key={column}
            type="button"
            tabIndex={column === tabStop ? 0 : -1}
            disabled={disabled}
            aria-label={`${props.modelName}, ${label}`}
            aria-pressed={props.isActive && isCurrent}
            className="group/cell relative z-10 flex h-7 w-8 cursor-pointer touch-pan-y items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
            onFocus={() => setFocused(column)}
            onPointerDown={(event) => {
              if (event.button !== 0 || disabled) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                pointerId: event.pointerId,
                start: column,
                column,
                chosen: false,
              };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (drag?.pointerId !== event.pointerId || drag.chosen) return;
              const next = levelAtPointer(event, columns, levels, drag.column);
              if (next === drag.column) return;
              drag.column = next;
              setDragged(next);
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current;
              if (drag?.pointerId !== event.pointerId || drag.chosen) return;
              setDragged(null);
              // Releasing where the press started is a click, which chooses below.
              if (drag.column === drag.start) return;
              drag.chosen = true;
              props.onChoose(drag.column, false);
            }}
            onPointerCancel={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              dragRef.current = null;
              setDragged(null);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              // A drag chose on release; keyboard clicks (detail 0) always choose.
              const choseOnRelease = event.detail !== 0 && dragRef.current?.chosen === true;
              dragRef.current = null;
              if (!choseOnRelease) props.onChoose(column, false);
            }}
            {...keepOpenClickHandlers(() => props.onChoose(column, true))}
            onKeyDown={handleCellKeyDown}
          >
            <span
              aria-hidden="true"
              className={cn(
                "rounded-full",
                column === shown
                  ? "size-5 bg-background shadow-sm"
                  : filled
                    ? "size-1 bg-background/60 group-hover/cell:size-2"
                    : isCurrent
                      ? "size-2 ring-1 ring-muted-foreground group-hover/cell:bg-current group-hover/cell:ring-0"
                      : "size-1 bg-muted-foreground/45 group-hover/cell:size-2.5 group-hover/cell:bg-current",
              )}
            />
          </button>
        );
      })}
    </div>
  );
  return (
    <div
      role="group"
      aria-label={`${props.modelName} reasoning and speed`}
      data-reasoning-row={props.rowKey}
      className={cn("flex shrink-0 text-foreground", accent.className)}
      style={accent.style}
    >
      {props.lockReason === null ? (
        levelCells
      ) : (
        <Tooltip>
          <TooltipTrigger render={levelCells} />
          <TooltipPopup side="left">{props.lockReason}</TooltipPopup>
        </Tooltip>
      )}
      {props.speedColumns.length > 0 ? <SpeedDivider /> : null}
      {props.speedColumns.map((tier) => {
        if (!props.speedTiers.includes(tier)) {
          return <span key={tier} aria-hidden="true" className="h-7 w-7" />;
        }
        const selected = tier === props.speedCurrent;
        return (
          <button
            key={tier}
            type="button"
            tabIndex={tier === speedTabStop ? 0 : -1}
            disabled={props.disabled}
            aria-label={`${props.modelName}, ${SPEED_TIER_LABELS[tier]} speed`}
            aria-pressed={props.isActive && selected}
            className={cn(
              "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed",
              props.isActive && selected
                ? "bg-current"
                : selected
                  ? "hover:bg-accent"
                  : "text-muted-foreground/45 hover:text-foreground",
            )}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onChooseSpeed(tier, false);
            }}
            {...keepOpenClickHandlers(() => props.onChooseSpeed(tier, true))}
            onKeyDown={handleCellKeyDown}
          >
            {/* Selected on another row is plain foreground: that row would run at it. */}
            <span
              className={cn(
                "flex",
                props.isActive && selected
                  ? "text-background"
                  : selected
                    ? "text-foreground"
                    : undefined,
              )}
            >
              {tier === "standard" ? (
                <span
                  aria-hidden="true"
                  className={cn("rounded-full bg-current", selected ? "size-1.5" : "size-1")}
                />
              ) : tier === "fast" ? (
                <ZapIcon aria-hidden="true" className="size-3 fill-current text-inherit" />
              ) : (
                <UltrafastIcon aria-hidden="true" className="size-3 text-inherit" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
});
