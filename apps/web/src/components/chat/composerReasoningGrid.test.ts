import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { resolveReasoningGridSelection } from "./composerReasoningGrid";

function providerEntry(
  driver: string,
  models: ReadonlyArray<{ slug: string; descriptors: ReadonlyArray<ProviderOptionDescriptor> }>,
) {
  const provider = {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-25T00:00:00.000Z",
    models: models.map((model) => ({
      slug: model.slug,
      name: model.slug,
      isCustom: false,
      capabilities: { optionDescriptors: [...model.descriptors] },
    })),
    slashCommands: [],
    skills: [],
  } satisfies ServerProvider;
  return deriveProviderInstanceEntries([provider])[0]!;
}

const claudeEffort = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "high", label: "High", isDefault: true },
  ],
} satisfies ProviderOptionDescriptor;

const claude = providerEntry("claudeAgent", [
  { slug: "claude-sonnet-5-5", descriptors: [claudeEffort] },
  {
    slug: "claude-opus-4-6",
    descriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
          { id: "max", label: "Max" },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        promptInjectedValues: ["ultrathink"],
      },
      { id: "fastMode", label: "Fast Mode", type: "boolean" },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
      },
    ],
  },
]);

const codex = providerEntry("codex", [
  {
    slug: "gpt-6-astra",
    descriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "medium", label: "Medium", isDefault: true },
          { id: "xhigh", label: "Extra High" },
        ],
      },
      {
        id: "serviceTier",
        label: "Service Tier",
        type: "select",
        options: [
          { id: "default", label: "Standard", isDefault: true },
          { id: "priority", label: "Fast" },
        ],
        currentValue: "default",
      },
    ],
  },
]);

describe("resolveReasoningGridSelection", () => {
  it("changes only the chosen level and speed, keeping the model's other remembered options", () => {
    expect(
      resolveReasoningGridSelection({
        entry: claude,
        slug: "claude-opus-4-6",
        baseOptions: [{ id: "contextWindow", value: "200k" }],
        column: "low",
        speed: "fast",
        planModeEnabled: true,
      }),
    ).toEqual({
      options: [
        { id: "contextWindow", value: "200k" },
        { id: "effort", value: "low" },
        { id: "fastMode", value: true },
      ],
      setsPromptLevel: true,
    });
  });

  it("leaves unset options unset so they still defer to the provider", () => {
    expect(
      resolveReasoningGridSelection({
        entry: codex,
        slug: "gpt-6-astra",
        baseOptions: undefined,
        column: "xhigh",
        speed: null,
        planModeEnabled: true,
      }),
    ).toEqual({ options: [{ id: "reasoningEffort", value: "xhigh" }], setsPromptLevel: false });
  });
});
