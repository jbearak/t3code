import { resolveReasoningGridRow } from "@t3tools/client-runtime/model-reasoning-grid";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import type { ModelPickerReasoningGrid } from "./modelPickerReasoningGrid";
import { ProviderModelPicker } from "./ProviderModelPicker";

const CLAUDE = ProviderInstanceId.make("claudeAgent");
const CODEX = ProviderInstanceId.make("codex");

function levels(id: string, ids: ReadonlyArray<string>, current: string): ProviderOptionDescriptor {
  return {
    id,
    label: "Reasoning",
    type: "select",
    options: ids.map((option) => ({ id: option, label: option })),
    currentValue: current,
  };
}

const descriptorsBySlug: Record<string, ReadonlyArray<ProviderOptionDescriptor>> = {
  "claude-opus-5-5": [
    levels("effort", ["low", "medium", "high", "xhigh", "max", "ultracode"], "medium"),
    { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
  ],
  "gpt-6-astra": [levels("reasoningEffort", ["low", "medium", "high", "xhigh"], "xhigh")],
};

function provider(instanceId: ProviderInstanceId, slug: string, name: string) {
  return {
    instanceId,
    driver: ProviderDriverKind.make(instanceId),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-25T00:00:00.000Z",
    models: [
      {
        slug,
        name,
        isCustom: false,
        capabilities: { optionDescriptors: [...descriptorsBySlug[slug]!] },
      },
    ],
    slashCommands: [],
    skills: [],
  } satisfies ServerProvider;
}

const instanceEntries = deriveProviderInstanceEntries([
  provider(CLAUDE, "claude-opus-5-5", "Claude Opus 5.5"),
  provider(CODEX, "gpt-6-astra", "GPT-6 Astra"),
]);
const modelOptionsByInstance = new Map(
  instanceEntries.map((entry) => [entry.instanceId, entry.models] as const),
);

function setup() {
  const onChoose = vi.fn<ModelPickerReasoningGrid["onChoose"]>();
  const onSpeedChange = vi.fn<ModelPickerReasoningGrid["onSpeedChange"]>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const grid: ModelPickerReasoningGrid = {
    showMax: false,
    ownsEffortShortcut: true,
    promptLocksReasoning: false,
    getRow: (_instanceId, slug) => resolveReasoningGridRow(descriptorsBySlug[slug] ?? []),
    getSpeed: (_instanceId, slug) => ({
      tiers: ["standard", "fast"],
      current: slug === "gpt-6-astra" ? "fast" : "standard",
    }),
    onSpeedChange,
    onChoose,
    display: { reasoningLabel: "Medium", speed: "standard" },
  };

  function Picker() {
    const [open, setOpen] = useState(true);
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={CLAUDE}
        model="claude-opus-5-5"
        lockedProvider={null}
        instanceEntries={instanceEntries}
        keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
        modelOptionsByInstance={modelOptionsByInstance}
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
        onInstanceModelChange={() => {}}
        reasoningGrid={grid}
      />
    );
  }
  return { Picker, onChoose, onSpeedChange, onOpenChange };
}

const dot = (name: string) => page.getByRole("button", { name, exact: true });

it("chooses a model and level together and closes", async () => {
  const { Picker, onChoose, onOpenChange } = setup();
  await using _screen = await render(<Picker />);
  await userEvent.click(page.getByRole("button", { name: "Codex" }));

  await userEvent.click(dot("GPT-6 Astra, Medium"));

  expect(onChoose).toHaveBeenCalledWith(CODEX, "gpt-6-astra", false, "medium", { keepOpen: false });
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it("chooses a model by name at its remembered level and closes", async () => {
  const { Picker, onChoose, onOpenChange } = setup();
  await using _screen = await render(<Picker />);
  await userEvent.click(page.getByRole("button", { name: "Codex" }));

  await userEvent.click(page.getByText("GPT-6 Astra", { exact: true }));

  expect(onChoose).toHaveBeenCalledWith(CODEX, "gpt-6-astra", false, null);
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it("reaches a model's levels with Tab and picks one with the arrow keys", async () => {
  const { Picker, onChoose } = setup();
  await using _screen = await render(<Picker />);
  await userEvent.click(page.getByRole("button", { name: "Codex" }));
  await userEvent.click(page.getByPlaceholder("Search models..."));

  await userEvent.keyboard("{Tab}");
  await expect.element(dot("GPT-6 Astra, Extra High")).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}{Enter}");

  expect(onChoose).toHaveBeenCalledTimes(1);
  expect(onChoose).toHaveBeenCalledWith(CODEX, "gpt-6-astra", false, "high", { keepOpen: false });
});

it("chooses the level a drag along a row ends on", async () => {
  const { Picker, onChoose } = setup();
  await using _screen = await render(<Picker />);
  await userEvent.click(page.getByRole("button", { name: "Codex" }));

  await userEvent.dragAndDrop(dot("GPT-6 Astra, Low"), dot("GPT-6 Astra, High"));

  expect(onChoose).toHaveBeenCalledTimes(1);
  expect(onChoose).toHaveBeenCalledWith(CODEX, "gpt-6-astra", false, "high", { keepOpen: false });
});

it("changes the current model's speed, or switches to another model at a speed, and closes", async () => {
  {
    const { Picker, onSpeedChange, onOpenChange } = setup();
    await using _screen = await render(<Picker />);
    await userEvent.click(dot("Claude Opus 5.5, Fast speed"));
    expect(onSpeedChange).toHaveBeenCalledWith("fast");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  }
  const { Picker, onChoose, onOpenChange } = setup();
  await using _screen = await render(<Picker />);
  await userEvent.click(page.getByRole("button", { name: "Codex" }));
  await userEvent.click(dot("GPT-6 Astra, Standard speed"));
  expect(onChoose).toHaveBeenCalledWith(CODEX, "gpt-6-astra", false, null, {
    speed: "standard",
    keepOpen: false,
  });
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it("keeps the picker open when choosing with a middle- or right-click", async () => {
  const { Picker, onChoose, onSpeedChange, onOpenChange } = setup();
  await using _screen = await render(<Picker />);

  await userEvent.click(dot("Claude Opus 5.5, High"), { button: "right" });
  await userEvent.click(dot("Claude Opus 5.5, Fast speed"), { button: "middle" });

  expect(onChoose).toHaveBeenCalledWith(CLAUDE, "claude-opus-5-5", true, "high", {
    keepOpen: true,
  });
  expect(onSpeedChange).toHaveBeenCalledWith("fast");
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});
