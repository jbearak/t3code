import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildReasoningGridDisplay,
  resolveReasoningGridRow,
  resolveSpeedControl,
  visibleReasoningColumns,
} from "./modelReasoningGrid.ts";

const claudeEffort = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra High" },
    { id: "max", label: "Max" },
    { id: "ultracode", label: "Ultracode" },
    { id: "ultrathink", label: "Ultrathink" },
  ],
  promptInjectedValues: ["ultrathink"],
} satisfies ProviderOptionDescriptor;

const codexTiers = {
  id: "serviceTier",
  label: "Service Tier",
  type: "select",
  options: [
    { id: "default", label: "Standard", isDefault: true },
    { id: "priority", label: "Fast" },
    { id: "ultrafast", label: "Ultrafast" },
  ],
  currentValue: "default",
} satisfies ProviderOptionDescriptor;

function reasoning(ids: ReadonlyArray<string>, currentValue?: string): ProviderOptionDescriptor {
  return {
    id: "reasoningEffort",
    label: "Reasoning",
    type: "select",
    options: ids.map((id) => ({ id, label: id })),
    ...(currentValue ? { currentValue } : {}),
  };
}

describe("resolveReasoningGridRow", () => {
  it("places Ultracode on the Fleet column and leaves the prompt-only Ultrathink off the grid", () => {
    const row = resolveReasoningGridRow([{ ...claudeEffort, currentValue: "ultracode" }]);

    expect(row).toEqual({
      descriptorId: "effort",
      optionIdByColumn: {
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
        ultra: "ultracode",
      },
      current: "ultra",
      promptInjected: true,
    });
  });

  it("maps Pi's off level to None", () => {
    const row = resolveReasoningGridRow([
      { ...reasoning(["off", "low", "high"], "off"), id: "thinking" },
    ]);

    expect(row?.optionIdByColumn).toEqual({ none: "off", low: "low", high: "high" });
    expect(row?.current).toBe("none");
  });

  it("leaves levels without a column to the model's own menu", () => {
    expect(resolveReasoningGridRow([{ ...reasoning(["low", "thinking"]), id: "variant" }])).toBe(
      null,
    );
    expect(resolveReasoningGridRow([codexTiers])).toBe(null);
  });
});

describe("visibleReasoningColumns", () => {
  const standard = resolveReasoningGridRow([reasoning(["low", "medium", "high"], "low")]);
  const withMinimalAndMax = resolveReasoningGridRow([
    reasoning(["minimal", "low", "medium", "max"], "low"),
  ]);
  const onMax = resolveReasoningGridRow([reasoning(["low", "max"], "max")]);

  it("adds None and Minimal only when a listed model offers them", () => {
    expect(visibleReasoningColumns([standard], { showMax: false })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultra",
    ]);
    expect(visibleReasoningColumns([standard, withMinimalAndMax], { showMax: false })).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultra",
    ]);
  });

  it("shows Max when enabled or when a listed model already runs at Max", () => {
    expect(visibleReasoningColumns([withMinimalAndMax], { showMax: true })).toContain("max");
    expect(visibleReasoningColumns([onMax], { showMax: false })).toContain("max");
    expect(visibleReasoningColumns([standard], { showMax: true })).not.toContain("max");
  });
});

describe("speed", () => {
  it("reads Claude's Fast mode switch and Codex's service tiers as speed tiers", () => {
    expect(
      resolveSpeedControl([
        claudeEffort,
        { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: true },
      ]),
    ).toMatchObject({
      descriptorId: "fastMode",
      valueByTier: { standard: false, fast: true },
      current: "fast",
    });
    expect(resolveSpeedControl([{ ...codexTiers, currentValue: "ultrafast" }])).toMatchObject({
      valueByTier: { standard: "default", fast: "priority", ultrafast: "ultrafast" },
      current: "ultrafast",
    });
  });

  it("leaves tiers it cannot name to the model's own menu", () => {
    expect(
      resolveSpeedControl([
        {
          ...codexTiers,
          options: [...codexTiers.options, { id: "flex", label: "Flex" }],
        },
      ]),
    ).toBe(null);
  });
});

describe("buildReasoningGridDisplay", () => {
  it("names the native level and reports speed separately", () => {
    expect(
      buildReasoningGridDisplay({
        descriptors: [
          { ...claudeEffort, currentValue: "ultracode" },
          { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: true },
        ],
        promptUltrathink: false,
      }),
    ).toEqual({ reasoningLabel: "Ultracode", speed: "fast" });
  });

  it("shows Ultrathink while the prompt sets it", () => {
    expect(
      buildReasoningGridDisplay({ descriptors: [claudeEffort], promptUltrathink: true }),
    ).toEqual({ reasoningLabel: "Ultrathink", speed: "standard" });
  });
});
