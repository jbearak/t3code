import {
  buildReasoningGridDisplay,
  resolveReasoningGridRow,
  resolveSpeedControl,
  SPEED_TIERS,
  withProviderOptionValue,
  type ReasoningColumn,
  type SpeedTier,
} from "@t3tools/client-runtime/model-reasoning-grid";
import type {
  ModelCapabilities,
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import { type ComposerThreadTarget, useComposerDraftStore } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { withImplicitFastModeDefault } from "./composerProviderState";
import type { ModelPickerReasoningGrid } from "./modelPickerReasoningGrid";
import type { PromptUltrathink } from "./TraitsPicker";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

function descriptorsFor(
  caps: ModelCapabilities,
  options: ProviderOptions | undefined,
): {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly selections: ProviderOptions | undefined;
} {
  const selections = withImplicitFastModeDefault(caps, options);
  return { descriptors: getProviderOptionDescriptors({ caps, selections }), selections };
}

function modelDescriptors(input: {
  readonly entry: ProviderInstanceEntry;
  readonly slug: string;
  readonly options: ProviderOptions | undefined;
  readonly planModeEnabled: boolean;
}) {
  return descriptorsFor(
    getProviderModelCapabilities(
      input.entry.models,
      input.slug,
      input.entry.driverKind,
      input.planModeEnabled,
    ),
    input.options,
  );
}

function reasoningGridDescriptorIds(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<string> {
  return [
    resolveReasoningGridRow(descriptors)?.descriptorId,
    resolveSpeedControl(descriptors)?.descriptorId,
  ].filter((id) => id !== undefined);
}

/** Only the chosen level and speed change; null when the model lacks that level. */
export function resolveReasoningGridSelection(input: {
  readonly entry: ProviderInstanceEntry;
  readonly slug: string;
  readonly baseOptions: ProviderOptions | undefined;
  readonly column: ReasoningColumn | null;
  readonly speed: SpeedTier | null;
  readonly planModeEnabled: boolean;
}): { readonly options: ProviderOptions | undefined; readonly setsPromptLevel: boolean } | null {
  const { descriptors } = modelDescriptors({
    entry: input.entry,
    slug: input.slug,
    options: input.baseOptions,
    planModeEnabled: input.planModeEnabled,
  });
  let options = input.baseOptions;
  let setsPromptLevel = false;
  if (input.column !== null) {
    const row = resolveReasoningGridRow(descriptors);
    const optionId = row?.optionIdByColumn[input.column];
    if (!row || optionId === undefined) return null;
    options = withProviderOptionValue(options, row.descriptorId, optionId);
    setsPromptLevel = row.promptInjected;
  }
  const control = input.speed === null ? null : resolveSpeedControl(descriptors);
  const value = input.speed === null ? undefined : control?.valueByTier[input.speed];
  if (control && value !== undefined) {
    options = withProviderOptionValue(options, control.descriptorId, value);
  }
  return { options, setsPromptLevel };
}

export function useComposerReasoningGrid(input: {
  readonly threadTarget: ComposerThreadTarget | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
  readonly activeOptions: ProviderOptions | undefined;
  readonly reportedModelSelection: ModelSelection | null | undefined;
  readonly planModeEnabled: boolean;
  readonly promptUltrathink: PromptUltrathink;
  readonly onPromptEdit: (
    edit: (prompt: string) => string,
    options?: { readonly focusComposer?: boolean },
  ) => void;
  readonly showMax: boolean;
  readonly onProviderModelSelect: (
    instanceId: ProviderInstanceId,
    model: string,
    options?: {
      readonly focusComposer?: boolean;
      readonly modelOptions?: ProviderOptions | undefined;
    },
  ) => boolean;
}): {
  readonly grid: ModelPickerReasoningGrid;
  readonly handledDescriptorIds: ReadonlyArray<string>;
  readonly handlesReasoning: boolean;
} {
  const {
    threadTarget,
    instanceEntries,
    activeInstanceId,
    activeModel,
    activeOptions,
    reportedModelSelection,
    planModeEnabled,
    promptUltrathink,
    onPromptEdit,
    onProviderModelSelect,
  } = input;
  const optionsByModelByProvider = useComposerDraftStore(
    (store) => store.stickyOptionsByModelByProvider,
  );
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const entryById = new Map(instanceEntries.map((entry) => [entry.instanceId, entry] as const));
  const activeEntry = entryById.get(activeInstanceId);
  const active = activeEntry
    ? modelDescriptors({
        entry: activeEntry,
        slug: activeModel,
        options: activeOptions,
        planModeEnabled,
      })
    : null;
  const activeDescriptors = active?.descriptors ?? [];
  // Includes the implicit Fast mode default the composer sends, so a reported value can't override it.
  const activeSelection: ModelSelection = {
    instanceId: activeInstanceId,
    model: activeModel,
    options: active?.selections ?? activeOptions ?? [],
  };
  const speed = resolveSpeedControl(activeDescriptors, activeSelection, reportedModelSelection);

  const baseOptionsFor = (instanceId: ProviderInstanceId, slug: string, isActive: boolean) =>
    isActive ? activeOptions : optionsByModelByProvider[instanceId]?.[slug];

  // Rows read catalog capabilities directly: plan mode only removes an agent option the grid ignores.
  const modelBySlugByInstance = new Map(
    instanceEntries.map(
      (entry) =>
        [entry.instanceId, new Map(entry.models.map((model) => [model.slug, model]))] as const,
    ),
  );

  const rowDescriptors = (instanceId: ProviderInstanceId, slug: string) => {
    const model = modelBySlugByInstance.get(instanceId)?.get(slug);
    if (!model?.capabilities) return null;
    return descriptorsFor(model.capabilities, optionsByModelByProvider[instanceId]?.[slug])
      .descriptors;
  };

  const getRow: ModelPickerReasoningGrid["getRow"] = (instanceId, slug, isActive) => {
    if (isActive) {
      return resolveReasoningGridRow(activeDescriptors, activeSelection, reportedModelSelection);
    }
    const descriptors = rowDescriptors(instanceId, slug);
    return descriptors ? resolveReasoningGridRow(descriptors) : null;
  };

  const getSpeed: ModelPickerReasoningGrid["getSpeed"] = (instanceId, slug, isActive) => {
    const descriptors = isActive ? activeDescriptors : rowDescriptors(instanceId, slug);
    const control = isActive ? speed : descriptors ? resolveSpeedControl(descriptors) : null;
    if (!control) return null;
    return {
      tiers: SPEED_TIERS.filter((tier) => control.valueByTier[tier] !== undefined),
      current: control.current,
    };
  };

  const onChoose: ModelPickerReasoningGrid["onChoose"] = (
    instanceId,
    slug,
    isActive,
    column,
    options,
  ) => {
    const entry = entryById.get(instanceId);
    if (!entry) return;
    const selection = resolveReasoningGridSelection({
      entry,
      slug,
      baseOptions: baseOptionsFor(instanceId, slug, isActive),
      column,
      // Writing the shown speed keeps Codex from holding on to the previous model's tier.
      speed:
        options?.speed ?? (isActive ? null : (getSpeed(instanceId, slug, false)?.current ?? null)),
      planModeEnabled,
    });
    if (!selection) return;
    if (selection.setsPromptLevel && promptUltrathink === "body") return;
    const selected = onProviderModelSelect(instanceId, slug, {
      focusComposer: options?.keepOpen !== true,
      ...(selection.options ? { modelOptions: selection.options } : {}),
    });
    if (!selected) return;
    // Choosing a level replaces a typed "Ultrathink:" prefix.
    if (selection.setsPromptLevel && promptUltrathink === "prefix") {
      onPromptEdit((prompt) => prompt.replace(/^Ultrathink:\s*/i, ""), {
        focusComposer: options?.keepOpen !== true,
      });
    }
  };

  const onSpeedChange: ModelPickerReasoningGrid["onSpeedChange"] = (tier) => {
    const value = speed?.valueByTier[tier];
    if (!speed || value === undefined || !activeEntry || !threadTarget) return;
    setProviderModelOptions(
      threadTarget,
      activeEntry.driverKind,
      withProviderOptionValue(activeOptions, speed.descriptorId, value),
      { instanceId: activeInstanceId, model: activeModel, persistSticky: true },
    );
  };

  const handlesReasoning = resolveReasoningGridRow(activeDescriptors) !== null;
  return {
    grid: {
      showMax: input.showMax,
      ownsEffortShortcut: handlesReasoning,
      promptLocksReasoning: promptUltrathink === "body",
      getRow,
      getSpeed,
      onSpeedChange,
      onChoose,
      display: buildReasoningGridDisplay({
        descriptors: activeDescriptors,
        promptUltrathink: promptUltrathink !== "none",
        modelSelection: activeSelection,
        reportedModelSelection,
      }),
    },
    handledDescriptorIds: reasoningGridDescriptorIds(activeDescriptors),
    handlesReasoning,
  };
}
