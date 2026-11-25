import type { CodeViewScrollTarget } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { createCodeViewScrollRestore } from "./useCodeViewScrollRestore";

function viewer(scrollHeight: number, height = 500) {
  // Each drawn file: its top, its added line count, and the line under the sticky header.
  const files: Array<{
    id: string;
    top: number;
    lines: number;
    line?: { lineNumber: number; top: number };
  }> = [];
  const instance = {
    scrollHeight,
    height,
    scrollTop: 0,
    // The stretch whose rows are drawn; a jump lands outside it until the viewer renders.
    drawn: { top: 0, bottom: Number.MAX_SAFE_INTEGER },
    files,
    getHeight: () => instance.height,
    getScrollHeight: () => instance.scrollHeight,
    getScrollTop: () => instance.scrollTop,
    getWindowSpecs: () => instance.drawn,
    getItem: (id: string) => {
      const file = instance.files.find((candidate) => candidate.id === id);
      if (file === undefined) return undefined;
      const hunk = {
        additionStart: 1,
        additionCount: file.lines,
        deletionStart: 0,
        deletionCount: 0,
      };
      // A file shown before its patch loads has no hunks and a pending cache key.
      return file.lines === 0
        ? { type: "diff", fileDiff: { cacheKey: `${id}:pending`, hunks: [] } }
        : { type: "diff", fileDiff: { cacheKey: id, hunks: [hunk] } };
    },
    getTopForItem: (id: string) => instance.files.find((file) => file.id === id)?.top,
    getRenderedItems: () =>
      instance.files.map((file) => ({
        id: file.id,
        instance: { getNumericScrollAnchor: () => file.line },
      })),
  };
  const scrolls: CodeViewScrollTarget[] = [];
  return {
    instance,
    scrolls,
    getInstance: () => instance,
    scrollTo: (target: CodeViewScrollTarget) => scrolls.push(target),
  };
}

function mount(
  scopeKey: string,
  view: ReturnType<typeof viewer>,
  settled = true,
  loadMore: (() => void) | null = null,
  loaded = 0,
) {
  const restore = createCodeViewScrollRestore();
  restore.update(scopeKey, settled, loadMore, loaded);
  restore.attach(view);
  return restore;
}

describe("createCodeViewScrollRestore", () => {
  it("puts a remounted viewer back at its scope's position, not another scope's", () => {
    const first = viewer(10_000);
    mount("thread-a", first).onScroll(4000, first.instance);
    const other = viewer(10_000);
    mount("thread-b", other).onScroll(1200, other.instance);

    const again = viewer(10_000);
    mount("thread-a", again);
    // Pierre subtracts the 32px sticky header from an unclamped position target.
    expect(again.scrolls).toEqual([{ type: "position", position: 4032 }]);
  });

  it("loads more files until the position is reachable, then gives up once none remain", () => {
    const first = viewer(10_000);
    mount("thread-c", first).onScroll(4000, first.instance);

    const loading = viewer(700);
    let batches = 0;
    const restore = mount("thread-c", loading, false, () => {
      batches += 1;
    });
    restore.onScroll(0, loading.instance);
    restore.flush();
    expect(loading.scrolls).toEqual([]);
    expect(batches).toBe(2);
    loading.instance.scrollHeight = 10_000;
    restore.flush();
    restore.flush();
    expect(loading.scrolls).toEqual([{ type: "position", position: 4032 }]);

    const shrunk = viewer(2000);
    const settling = mount("thread-c", shrunk, false);
    settling.flush();
    expect(shrunk.scrolls).toEqual([]);
    settling.update("thread-c", true, null);
    settling.flush();
    // Past the end, Pierre clamps the target to the bottom without subtracting the header.
    expect(shrunk.scrolls).toEqual([{ type: "position", position: 1532 }]);

    // The viewer's own end can lie past the files (a footer), so the last 32px is left to it.
    const nearEnd = viewer(2000);
    mount("thread-near-end", nearEnd).onScroll(1476, nearEnd.instance);
    const nearEndAgain = viewer(2000);
    mount("thread-near-end", nearEndAgain);
    expect(nearEndAgain.scrolls).toEqual([{ type: "position", position: 1508 }]);
  });

  it("waits for as many batches as were shown when the position was saved", () => {
    const first = viewer(10_000);
    mount("pull-request-a", first, true, null, 2).onScroll(300, first.instance);

    // The first batch alone is tall enough, but the second sorts files above it.
    const again = viewer(10_000);
    let batches = 0;
    const loadMore = () => {
      batches += 1;
    };
    const restore = mount("pull-request-a", again, false, loadMore, 1);
    expect(again.scrolls).toEqual([]);
    expect(batches).toBe(1);
    restore.update("pull-request-a", false, loadMore, 2);
    restore.flush();
    expect(again.scrolls).toEqual([{ type: "position", position: 332 }]);
  });

  it("holds a position, even one saved meanwhile, until the caller's layout is ready", () => {
    const first = viewer(10_000);
    const early = createCodeViewScrollRestore();
    early.update("pull-request-b", true, null, 1, false);
    early.attach(first);
    early.onScroll(400, first.instance);

    const again = viewer(10_000);
    const restore = createCodeViewScrollRestore();
    restore.update("pull-request-b", true, null, 1, false);
    restore.attach(again);
    restore.flush();
    expect(again.scrolls).toEqual([]);
    restore.update("pull-request-b", true, null, 1, true);
    restore.flush();
    expect(again.scrolls).toEqual([{ type: "position", position: 432 }]);
  });

  it("lets a reader who scrolls while more files load keep their own position", () => {
    const first = viewer(10_000);
    mount("thread-e", first).onScroll(4000, first.instance);

    const loading = viewer(700);
    const restore = mount("thread-e", loading, false, () => {});
    // Unreached until a scroll replaces it: a click that cut the restore short scrolls nothing.
    expect(restore.cancel()).toBe(true);
    expect(restore.cancel()).toBe(true);
    expect(createCodeViewScrollRestore().cancel()).toBe(true);
    restore.onScroll(150, loading.instance);
    expect(restore.cancel()).toBe(false);
    loading.instance.scrollHeight = 10_000;
    restore.update("thread-e", true, null);
    restore.flush();
    expect(loading.scrolls).toEqual([]);

    const again = viewer(10_000);
    mount("thread-e", again);
    expect(again.scrolls).toEqual([{ type: "position", position: 182 }]);
  });

  it("moves a viewer kept across a scope change to that scope's position, not the old one", () => {
    const commitA = viewer(10_000);
    mount("commit-a", commitA).onScroll(3000, commitA.instance);
    const commitB = viewer(10_000);
    mount("commit-b", commitB).onScroll(800, commitB.instance);

    const kept = viewer(700);
    const restore = mount("commit-a", kept, false, () => {});
    restore.update("commit-b", true, null);
    kept.instance.scrollHeight = 10_000;
    restore.flush();
    expect(kept.scrolls).toEqual([{ type: "position", position: 832 }]);
  });

  it("aims at the line that was under the sticky header, wherever the new viewer puts it", () => {
    const first = viewer(10_000);
    first.instance.files = [
      { id: "a", top: 0, lines: 100 },
      { id: "b", top: 3000, lines: 100, line: { lineNumber: 40, top: 1100 } },
      { id: "c", top: 6000, lines: 100 },
    ];
    mount("thread-line", first).onScroll(4000, first.instance);

    // Line 40 sat 68px under the header: 3000 + 1100 - 4000 - 32.
    const line = { type: "line", id: "b", lineNumber: 40, align: "start", offset: 68 };
    const loading = viewer(700);
    let batches = 0;
    const restore = mount("thread-line", loading, false, () => {
      batches += 1;
    });
    expect(loading.scrolls).toEqual([]);
    expect(batches).toBe(1);
    // The file is back, so the line is reachable though the estimated height is not.
    loading.instance.files = [{ id: "b", top: 500, lines: 100 }];
    restore.flush();
    expect(loading.scrolls).toEqual([line]);
  });

  it("anchors a jump once the viewer has drawn the rows it landed on", () => {
    const first = viewer(10_000);
    first.instance.files = [{ id: "a", top: 0, lines: 100, line: { lineNumber: 5, top: 132 } }];
    first.instance.drawn = { top: 0, bottom: 1000 };
    const restore = mount("thread-jump", first);
    // Pierre reports the scroll first: the drawn file is still the one from before the jump.
    restore.onScroll(4000, first.instance);
    first.instance.scrollTop = 4000;
    first.instance.files = [
      { id: "b", top: 3000, lines: 100, line: { lineNumber: 40, top: 1100 } },
    ];
    first.instance.drawn = { top: 3500, bottom: 5000 };
    restore.flush();

    const again = viewer(10_000);
    again.instance.files = [{ id: "b", top: 2000, lines: 100 }];
    mount("thread-jump", again);
    expect(again.scrolls).toEqual([
      { type: "line", id: "b", lineNumber: 40, align: "start", offset: 68 },
    ]);
  });

  it("waits for the patch of a file that is shown before it loads", () => {
    const first = viewer(10_000);
    first.instance.files = [
      { id: "b", top: 3000, lines: 100, line: { lineNumber: 40, top: 1100 } },
    ];
    mount("thread-lazy", first).onScroll(4000, first.instance);

    // Header-only placeholders already make the viewer tall enough for the offset.
    const loading = viewer(10_000);
    loading.instance.files = [{ id: "b", top: 320, lines: 0 }];
    let batches = 0;
    const restore = mount("thread-lazy", loading, false, () => {
      batches += 1;
    });
    expect(loading.scrolls).toEqual([]);
    expect(batches).toBe(1);
    loading.instance.files = [{ id: "b", top: 320, lines: 100 }];
    restore.flush();
    expect(loading.scrolls).toEqual([
      { type: "line", id: "b", lineNumber: 40, align: "start", offset: 68 },
    ]);
  });

  it("falls back to the offset when the line or its file is gone", () => {
    const first = viewer(10_000);
    first.instance.files = [
      { id: "b", top: 3000, lines: 100, line: { lineNumber: 40, top: 1100 } },
    ];
    mount("thread-gone", first).onScroll(4000, first.instance);

    const shorter = viewer(10_000);
    shorter.instance.files = [{ id: "b", top: 3000, lines: 10 }];
    mount("thread-gone", shorter);
    const renamed = viewer(10_000);
    renamed.instance.files = [{ id: "other", top: 3000, lines: 100 }];
    mount("thread-gone", renamed);
    expect(shorter.scrolls).toEqual([{ type: "position", position: 4032 }]);
    expect(renamed.scrolls).toEqual([{ type: "position", position: 4032 }]);
  });

  it("aims at the next file's header when no line is left under the sticky one", () => {
    const first = viewer(10_000);
    // The end of a long file, or a collapsed one: its own top would count unmeasured rows.
    first.instance.files = [
      { id: "a", top: 0, lines: 100 },
      { id: "b", top: 3010, lines: 100 },
    ];
    mount("thread-next", first).onScroll(3000, first.instance);

    const again = viewer(10_000);
    again.instance.files = [{ id: "b", top: 2000, lines: 100 }];
    mount("thread-next", again);
    expect(again.scrolls).toEqual([{ type: "item", id: "b", align: "start", offset: 10 }]);
  });

  it("forgets a position that a reveal or collapsing every file replaced", () => {
    const first = viewer(10_000);
    const restore = mount("thread-d", first);
    restore.onScroll(4000, first.instance);
    restore.discard();

    const again = viewer(10_000);
    mount("thread-d", again);
    expect(again.scrolls).toEqual([]);
  });
});
