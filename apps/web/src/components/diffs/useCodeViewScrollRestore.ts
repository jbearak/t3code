import type { CodeViewScrollTarget, NumericScrollLineAnchor } from "@pierre/diffs";
import { useEffect, useState } from "react";

interface Viewer {
  getHeight(): number;
  getScrollHeight(): number;
  getScrollTop(): number;
  getWindowSpecs(): { readonly top: number; readonly bottom: number };
  getItem(id: string): Item | undefined;
  getTopForItem(id: string): number | undefined;
  getRenderedItems(): ReadonlyArray<{
    readonly id: string;
    readonly instance: {
      getNumericScrollAnchor(localViewportTop: number): NumericScrollLineAnchor | undefined;
    };
  }>;
}

interface Item {
  readonly type: string;
  readonly fileDiff?: {
    readonly cacheKey?: string;
    readonly hunks: ReadonlyArray<{
      readonly additionStart: number;
      readonly additionCount: number;
      readonly deletionStart: number;
      readonly deletionCount: number;
    }>;
  };
}

interface ScrollRestoreHandle {
  getInstance(): Viewer | undefined;
  scrollTo(target: CodeViewScrollTarget): void;
}

type Anchor = Extract<CodeViewScrollTarget, { type: "line" | "item" }>;

interface Saved {
  readonly scrollTop: number;
  readonly loaded: number;
  readonly anchor: Anchor | null;
}

// Session-only, like the panel's folds.
const savedByScopeKey = new Map<string, Saved>();

// Pierre's sticky file header covers the top of the viewport.
const STICKY_HEADER = 32;

/**
 * The first line under the sticky header, as the target that puts it back where it is now, or
 * null while the rows there are undrawn: Pierre reports a scroll before it draws them.
 */
function anchorAt(viewer: Viewer, scrollTop: number): Anchor | null {
  const drawn = viewer.getWindowSpecs();
  if (scrollTop <= 0 || scrollTop < drawn.top || scrollTop > drawn.bottom) return null;
  let file: { readonly id: string; readonly top: number } | null = null;
  let next: { readonly id: string; readonly top: number } | null = null;
  let line: NumericScrollLineAnchor | undefined;
  for (const item of viewer.getRenderedItems()) {
    const top = viewer.getTopForItem(item.id);
    if (top === undefined) continue;
    if (top > scrollTop) {
      next = { id: item.id, top };
      break;
    }
    file = { id: item.id, top };
    line = item.instance.getNumericScrollAnchor(scrollTop + STICKY_HEADER - top);
  }
  if (file === null) return null;
  if (line === undefined) {
    // A collapsed file has no line and neither does the end of a long one. Only a header in
    // view is near enough that its place does not depend on rows a new viewer has not measured.
    const header =
      next !== null && next.top < scrollTop + viewer.getHeight()
        ? next
        : scrollTop < file.top + STICKY_HEADER
          ? file
          : null;
    return (
      header && { type: "item", id: header.id, align: "start", offset: header.top - scrollTop }
    );
  }
  return {
    type: "line",
    id: file.id,
    lineNumber: line.lineNumber,
    ...(line.side === undefined ? {} : { side: line.side }),
    align: "start",
    // Pierre puts a line target under the sticky header before it subtracts the offset.
    offset: file.top + line.top - scrollTop - STICKY_HEADER,
  };
}

/** Pierre drops a target it cannot find and any target before it, so only a line it holds is sent. */
function holds(item: Item | undefined, anchor: Anchor): boolean {
  if (item === undefined) return false;
  if (anchor.type === "item") return true;
  const { lineNumber, side } = anchor;
  return (
    item.fileDiff?.hunks.some((hunk) =>
      side === "deletions"
        ? lineNumber >= hunk.deletionStart && lineNumber < hunk.deletionStart + hunk.deletionCount
        : lineNumber >= hunk.additionStart && lineNumber < hunk.additionStart + hunk.additionCount,
    ) ?? false
  );
}

/**
 * Puts a remounted code view back where its scope was last scrolled. `attach` is the viewer's
 * ref and `flush` its post-render handler; the position waits until the content can reach it,
 * loading more files while any remain, and clamps once nothing is left to load. `loaded` counts
 * the batches shown, for a caller whose batches reorder as they arrive.
 */
export function createCodeViewScrollRestore() {
  let scopeKey: string | null = null;
  let settled = true;
  let loadMore: (() => void) | null = null;
  let loaded = 0;
  // False while the caller still loads something that moves the content: scrolls save, none restore.
  let ready = true;
  let viewer: Viewer | undefined;
  let handle: ScrollRestoreHandle | null = null;
  let pending: Saved | null = null;
  // A restore the reader cut short leaves the saved position unreached until a scroll replaces it.
  let interrupted = false;
  const flush = () => {
    // A scroll is reported before its rows are drawn and measured, so the line saved with it can
    // be missing or estimated. While the viewer rests there, each render names it again.
    const key = pending === null ? scopeKey : null;
    const resting = key === null ? undefined : savedByScopeKey.get(key);
    if (key !== null && resting && viewer && resting.scrollTop === viewer.getScrollTop()) {
      const anchor = anchorAt(viewer, resting.scrollTop);
      if (anchor !== null) savedByScopeKey.set(key, { ...resting, anchor });
    }
    if (pending === null || !ready || !viewer || !handle || viewer.getHeight() === 0) return;
    const maxScrollTop = viewer.getScrollHeight() - viewer.getHeight();
    const item = pending.anchor === null ? undefined : viewer.getItem(pending.anchor.id);
    const anchor = pending.anchor !== null && holds(item, pending.anchor) ? pending.anchor : null;
    // The thread Diff tab shows a file before its patch loads, so its line waits for the patch.
    const awaited = anchor === null && item?.fileDiff?.cacheKey?.endsWith(":pending") === true;
    // Until as many batches are back as when it was saved, the offset can name another file.
    if (
      !settled &&
      (loaded < pending.loaded || awaited || (anchor === null && maxScrollTop < pending.scrollTop))
    ) {
      loadMore?.();
      return;
    }
    const scrollTop = Math.min(pending.scrollTop, maxScrollTop);
    pending = null;
    // The offset counts rows the old viewer measured. A new one estimates rows it has not drawn,
    // and a wrapped line or review card is taller than its estimate, so the line is the target.
    if (anchor !== null) handle.scrollTo(anchor);
    // Pierre lands an in-range position target one sticky header above it and clamps one past its
    // own end, which a footer extends, so a position in the last 32px lands at the end.
    else if (scrollTop > 0)
      handle.scrollTo({ type: "position", position: scrollTop + STICKY_HEADER });
  };
  return {
    update(
      nextScopeKey: string | null,
      nextSettled: boolean,
      nextLoadMore: (() => void) | null,
      nextLoaded = 0,
      nextReady = true,
    ) {
      // A viewer kept across a scope change takes the new scope's position, never the old one's.
      if (viewer && nextScopeKey !== scopeKey) {
        pending = nextScopeKey === null ? null : (savedByScopeKey.get(nextScopeKey) ?? null);
        interrupted = false;
      }
      scopeKey = nextScopeKey;
      settled = nextSettled;
      loadMore = nextLoadMore;
      loaded = nextLoaded;
      ready = nextReady;
    },
    attach(next: ScrollRestoreHandle | null) {
      handle = next;
      const instance = next?.getInstance();
      if (instance && instance !== viewer) {
        viewer = instance;
        pending = scopeKey === null ? null : (savedByScopeKey.get(scopeKey) ?? null);
        interrupted = false;
      }
      flush();
    },
    onScroll(scrollTop: number, source: object) {
      if (!viewer || source !== viewer || pending !== null || scopeKey === null) return;
      savedByScopeKey.set(scopeKey, { scrollTop, loaded, anchor: anchorAt(viewer, scrollTop) });
      interrupted = false;
    },
    /**
     * The reader acted before the saved position was reached. Reports whether it is unreached:
     * a restore was cut short and no scroll has been saved since, or no viewer has attached.
     */
    cancel() {
      if (pending !== null) interrupted = true;
      pending = null;
      return interrupted || handle === null;
    },
    /** Something else positions the viewer, such as a file reveal or collapsing every file. */
    discard() {
      pending = null;
      interrupted = false;
      if (scopeKey !== null) savedByScopeKey.delete(scopeKey);
    },
    flush,
  };
}

export function useCodeViewScrollRestore(
  scopeKey: string | null,
  settled: boolean,
  loadMore: (() => void) | null,
  loaded = 0,
  ready = true,
) {
  const [restore] = useState(createCodeViewScrollRestore);
  restore.update(scopeKey, settled, loadMore, loaded, ready);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a loaded batch can leave the viewer's rendered items alone, so no ref or post-render call re-checks the pending position
  useEffect(() => restore.flush());
  return restore;
}
