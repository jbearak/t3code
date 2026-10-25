import type {
  ModelSelection,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";
import { REASONING_SELECT_DESCRIPTOR_IDS } from "./modelTraits.ts";

const REASONING_COLUMNS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ReasoningColumn = (typeof REASONING_COLUMNS)[number];

export const REASONING_COLUMN_LABELS: Readonly<
  Record<ReasoningColumn, { readonly label: string; readonly shortLabel: string }>
> = {
  none: { label: "None", shortLabel: "None" },
  minimal: { label: "Minimal", shortLabel: "Min" },
  low: { label: "Low", shortLabel: "Low" },
  medium: { label: "Medium", shortLabel: "Med" },
  high: { label: "High", shortLabel: "High" },
  xhigh: { label: "Extra High", shortLabel: "XHigh" },
  max: { label: "Max", shortLabel: "Max" },
  ultra: { label: "Fleet", shortLabel: "Fleet" },
};

// Claude's Ultracode and Codex's Ultra differ in detail but share the top of the scale.
const COLUMN_BY_OPTION_ID: Readonly<Record<string, ReasoningColumn>> = {
  none: "none",
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  ultra: "ultra",
  ultracode: "ultra",
};

export interface ReasoningGridRow {
  readonly descriptorId: string;
  readonly optionIdByColumn: Readonly<Partial<Record<ReasoningColumn, string>>>;
  readonly current: ReasoningColumn | null;
  /** The level can also come from the prompt, as with Claude's "ultrathink". */
  readonly promptInjected: boolean;
}

/**
 * Places a model's reasoning choices on the shared scale. Returns null when any choice has no
 * column, so models with provider-specific levels keep their own menu instead of losing options.
 */
export function resolveReasoningGridRow(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): ReasoningGridRow | null {
  const descriptor = descriptors.find(
    (candidate): candidate is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      candidate.type === "select" && REASONING_SELECT_DESCRIPTOR_IDS.has(candidate.id),
  );
  if (!descriptor) return null;
  const promptInjectedValues = new Set(descriptor.promptInjectedValues ?? []);
  const optionIdByColumn: Partial<Record<ReasoningColumn, string>> = {};
  for (const option of descriptor.options) {
    if (promptInjectedValues.has(option.id)) continue;
    const column = COLUMN_BY_OPTION_ID[option.id];
    if (column === undefined || optionIdByColumn[column] !== undefined) return null;
    optionIdByColumn[column] = option.id;
  }
  if (Object.keys(optionIdByColumn).length === 0) return null;
  const value = getProviderOptionCurrentValue(descriptor, selection, reportedSelection);
  const current =
    typeof value === "string"
      ? (REASONING_COLUMNS.find((column) => optionIdByColumn[column] === value) ?? null)
      : null;
  return {
    descriptorId: descriptor.id,
    optionIdByColumn,
    current,
    promptInjected: promptInjectedValues.size > 0,
  };
}

/**
 * The fixed scale, plus None and Minimal when a listed model offers them. Max shows when enabled
 * or when a listed model is already set to it, so the picker never hides the level that runs.
 */
export function visibleReasoningColumns(
  rows: Iterable<ReasoningGridRow | null>,
  options: { readonly showMax: boolean },
): ReadonlyArray<ReasoningColumn> {
  const gridRows = Array.from(rows).filter((row): row is ReasoningGridRow => row !== null);
  if (gridRows.length === 0) return [];
  return REASONING_COLUMNS.filter((column) => {
    switch (column) {
      case "none":
      case "minimal":
        return gridRows.some((row) => row.optionIdByColumn[column] !== undefined);
      case "max":
        return gridRows.some(
          (row) =>
            row.optionIdByColumn.max !== undefined && (options.showMax || row.current === "max"),
        );
      default:
        return true;
    }
  });
}

export const SPEED_TIERS = ["standard", "fast", "ultrafast"] as const;

export type SpeedTier = (typeof SPEED_TIERS)[number];

export interface SpeedControl {
  readonly descriptorId: string;
  readonly valueByTier: Readonly<Partial<Record<SpeedTier, string | boolean>>>;
  readonly current: SpeedTier;
}

const SPEED_TIER_BY_OPTION: Readonly<Record<string, SpeedTier>> = {
  default: "standard",
  standard: "standard",
  priority: "fast",
  fast: "fast",
  ultrafast: "ultrafast",
};

export function resolveSpeedControl(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): SpeedControl | null {
  for (const descriptor of descriptors) {
    if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
      return {
        descriptorId: descriptor.id,
        valueByTier: { standard: false, fast: true },
        current:
          getProviderOptionCurrentValue(descriptor, selection, reportedSelection) === true
            ? "fast"
            : "standard",
      };
    }
    if (descriptor.id !== "serviceTier" || descriptor.type !== "select") continue;
    const valueByTier: Partial<Record<SpeedTier, string>> = {};
    for (const option of descriptor.options) {
      const tier =
        SPEED_TIER_BY_OPTION[option.id] ?? SPEED_TIER_BY_OPTION[option.label.toLowerCase()];
      if (tier === undefined || valueByTier[tier] !== undefined) return null;
      valueByTier[tier] = option.id;
    }
    if (valueByTier.standard === undefined || Object.keys(valueByTier).length < 2) return null;
    const value = getProviderOptionCurrentValue(descriptor, selection, reportedSelection);
    return {
      descriptorId: descriptor.id,
      valueByTier,
      current: SPEED_TIERS.find((tier) => valueByTier[tier] === value) ?? "standard",
    };
  }
  return null;
}

/** Sets only the options the choice changes, so unset options keep deferring to the provider. */
export function withProviderOptionValue(
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
  value: string | boolean,
): ReadonlyArray<ProviderOptionSelection> {
  return [...(options ?? []).filter((option) => option.id !== id), { id, value }];
}

export function buildReasoningGridDisplay(input: {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly promptUltrathink: boolean;
  readonly modelSelection?: ModelSelection | null;
  readonly reportedModelSelection?: ModelSelection | null | undefined;
}): { readonly reasoningLabel: string | null; readonly speed: SpeedTier } {
  const speed =
    resolveSpeedControl(input.descriptors, input.modelSelection, input.reportedModelSelection)
      ?.current ?? "standard";
  const row = resolveReasoningGridRow(input.descriptors);
  const descriptor = row
    ? input.descriptors.find((candidate) => candidate.id === row.descriptorId)
    : undefined;
  if (!row || !descriptor) return { reasoningLabel: null, speed };
  if (row.promptInjected && input.promptUltrathink) return { reasoningLabel: "Ultrathink", speed };
  return {
    reasoningLabel:
      getProviderOptionCurrentLabel(
        descriptor,
        input.modelSelection,
        input.reportedModelSelection,
      ) ?? null,
    speed,
  };
}
