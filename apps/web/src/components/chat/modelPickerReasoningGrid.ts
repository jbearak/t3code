import type {
  ReasoningColumn,
  ReasoningGridRow,
  SpeedTier,
} from "@t3tools/client-runtime/model-reasoning-grid";
import type { ProviderInstanceId } from "@t3tools/contracts";

/** The speeds a row offers and the one it would run at if chosen. */
export interface RowSpeed {
  readonly tiers: ReadonlyArray<SpeedTier>;
  readonly current: SpeedTier;
}

export interface ModelPickerReasoningGrid {
  readonly showMax: boolean;
  readonly ownsEffortShortcut: boolean;
  /** Claude reads "ultrathink" in the prompt body; its level can't change until that's removed. */
  readonly promptLocksReasoning: boolean;
  readonly getRow: (
    instanceId: ProviderInstanceId,
    slug: string,
    isActive: boolean,
  ) => ReasoningGridRow | null;
  readonly getSpeed: (
    instanceId: ProviderInstanceId,
    slug: string,
    isActive: boolean,
  ) => RowSpeed | null;
  readonly onSpeedChange: (tier: SpeedTier) => void;
  readonly onChoose: (
    instanceId: ProviderInstanceId,
    slug: string,
    isActive: boolean,
    /** Null keeps the model's remembered level. */
    column: ReasoningColumn | null,
    options?: {
      /** Omitted keeps the model's remembered speed. */
      readonly speed?: SpeedTier;
      /** The picker stays open, so the composer shouldn't take focus. */
      readonly keepOpen?: boolean;
    },
  ) => void;
  readonly display: {
    readonly reasoningLabel: string | null;
    readonly speed: SpeedTier;
  };
}

const internedColumns = new Map<string, ReadonlyArray<string>>();

/** Equal column lists share one array, so unchanged rows skip re-rendering while searching. */
export function internColumns<Column extends string>(
  columns: ReadonlyArray<Column>,
): ReadonlyArray<Column> {
  const key = columns.join(",");
  const existing = internedColumns.get(key) as ReadonlyArray<Column> | undefined;
  if (existing) return existing;
  internedColumns.set(key, columns);
  return columns;
}
