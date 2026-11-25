import { CodeView, DEFAULT_THEMES, parsePatchFiles, preloadHighlighter } from "@pierre/diffs";
import { expect, it, vi } from "vite-plus/test";

import { createCodeViewScrollRestore } from "./useCodeViewScrollRestore";

// Every sixth line is long enough to wrap in a 640px viewer.
function patchFor(name: string, count: number) {
  const lines = Array.from({ length: count }, (_, index) =>
    index % 6 === 0
      ? `+const value${index} = "${"word ".repeat(28)}";`
      : `+const value${index} = ${index};`,
  ).join("\n");
  return `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${count} @@\n${lines}\n`;
}

function mountViewer(patch: string, scopeKey: string) {
  const root = document.createElement("div");
  root.style.cssText = "width: 640px; height: 500px; overflow: auto;";
  document.body.append(root);
  const restore = createCodeViewScrollRestore();
  restore.update(scopeKey, true, null);
  // Wired as the diff tabs wire it: the viewer's scroll events save, its renders flush.
  const view = new CodeView<undefined>({
    diffStyle: "unified",
    overflow: "wrap",
    stickyHeaders: true,
    itemMetrics: { diffHeaderHeight: 32 },
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    onPostRender: () => restore.flush(),
  });
  view.setup(root);
  view.subscribeToScroll((scrollTop, source) => restore.onScroll(scrollTop, source));
  const files = parsePatchFiles(patch, { cacheKeyPrefix: scopeKey }).flatMap(
    (parsed) => parsed.files,
  );
  view.setItems(files.map((fileDiff) => ({ id: fileDiff.name, type: "diff" as const, fileDiff })));
  restore.attach({ getInstance: () => view, scrollTo: (target) => view.scrollTo(target) });
  return {
    root,
    view,
    /** The first line under the sticky header, with how far under it sits. */
    topLine: () => {
      const top = root.getBoundingClientRect().top + 32;
      for (const container of root.querySelectorAll("diffs-container")) {
        const line = [...(container.shadowRoot?.querySelectorAll("[data-line]") ?? [])].find(
          (element) => element.getBoundingClientRect().top >= top,
        );
        if (line) {
          return `${line.textContent?.slice(0, 20)} +${Math.round(line.getBoundingClientRect().top - top)}`;
        }
      }
      return null;
    },
    [Symbol.dispose]: () => {
      view.cleanUp();
      root.remove();
    },
  };
}

/** Scrolls a viewport at a time, as a reader does, so the viewer measures every row it passes. */
async function readDownTo(viewer: ReturnType<typeof mountViewer>, scrollTop: number) {
  for (let next = 500; next <= scrollTop; next += 500) {
    viewer.root.scrollTop = next;
    await vi.waitFor(() => {
      expect(viewer.view.getScrollTop()).toBe(viewer.root.scrollTop);
      expect(viewer.topLine()).not.toBeNull();
    });
  }
  return viewer.topLine();
}

const FILES = ["a.ts", "b.ts", "c.ts", "d.ts"];

// regression: a new viewer estimates the rows it has not drawn, and a wrapped line is taller than
// its estimate, so the saved offset alone came back more than a hundred lines further down
it("puts a remounted viewer of wrapped lines back on the line it was showing", async () => {
  await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["text"] });
  const patch = FILES.map((name) => patchFor(name, 300)).join("");
  let line: string | null;
  {
    using first = mountViewer(patch, "wrapped");
    line = await readDownTo(first, 10_000);
    expect(line).toContain("const value");
  }

  using again = mountViewer(patch, "wrapped");
  await vi.waitFor(() => expect(again.topLine()).toBe(line));
});

it("puts back a place the reader jumped to, which is saved before its rows are drawn", async () => {
  await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["text"] });
  const patch = FILES.map((name) => patchFor(name, 300)).join("");
  let line: string | null = null;
  {
    using first = mountViewer(patch, "jumped");
    await readDownTo(first, 14_000);
    // A scrollbar drag or a file reveal: far from the rows drawn now.
    first.root.scrollTop = 6000;
    await vi.waitFor(() => {
      line = first.topLine();
      expect(first.view.getScrollTop()).toBe(first.root.scrollTop);
      expect(line).toContain("const value");
    });
  }

  using again = mountViewer(patch, "jumped");
  await vi.waitFor(() => expect(again.topLine()).toBe(line));
});

it("lands on the saved offset when the saved line is no longer in the file", async () => {
  await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["text"] });
  {
    using first = mountViewer(FILES.map((name) => patchFor(name, 300)).join(""), "shortened");
    await readDownTo(first, 10_000);
  }

  // Pierre drops a line target it cannot find and leaves the viewer at the top.
  const shortened = FILES.map((name) => patchFor(name, name === "b.ts" ? 20 : 300)).join("");
  using again = mountViewer(shortened, "shortened");
  await vi.waitFor(() => expect(again.view.getScrollTop()).toBeGreaterThan(9000));
});
