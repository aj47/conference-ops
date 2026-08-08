// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAuthenticatedWorkspacePath,
  preserveUnsavedBuilder,
  useVisibleWorkspaceRefresh,
} from "../../src/client/workspace-refresh";

let container: HTMLDivElement;
let root: Root;

function Harness({ refresh, intervalMs = 25_000 }: { refresh: () => Promise<void>; intervalMs?: number }) {
  const [enabled, setEnabled] = useState(true);
  useVisibleWorkspaceRefresh({ enabled, refreshKey: "event-1:organizer", refresh, intervalMs });
  return <button type="button" onClick={() => setEnabled(false)}>stop</button>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("workspace refresh policy", () => {
  it("only enables polling on authenticated workspace routes", () => {
    expect(["/", "/workspace", "/forms", "/reviews", "/portal/home"].every(isAuthenticatedWorkspacePath)).toBe(true);
    expect(["/submit/ai-engineer", "/agenda", "/speakers", "/embed/agenda", "/auth", "/invite/token"].some(isAuthenticatedWorkspacePath)).toBe(false);
  });

  it("preserves a dirty builder and hydrates a clean one", () => {
    const dirty = { dirty: true, title: "Unsaved local title" };
    const clean = { dirty: false, title: "Old title" };
    const server = { dirty: false, title: "Server title" };
    expect(preserveUnsavedBuilder(dirty, server)).toBe(dirty);
    expect(preserveUnsavedBuilder(clean, server)).toBe(server);
    expect(preserveUnsavedBuilder(clean, undefined)).toBe(clean);
  });

  it("refreshes on the bounded interval and when the visible window regains focus", async () => {
    const refresh = vi.fn(async () => undefined);
    await act(async () => root.render(<Harness refresh={refresh} />));

    await act(async () => vi.advanceTimersByTimeAsync(25_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_001);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden and refreshes as soon as the tab becomes visible", async () => {
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const refresh = vi.fn(async () => undefined);
    await act(async () => root.render(<Harness refresh={refresh} />));

    await act(async () => vi.advanceTimersByTimeAsync(50_000));
    expect(refresh).not.toHaveBeenCalled();

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not overlap requests and silently retries after a rejected refresh", async () => {
    let finishFirst: (() => void) | undefined;
    const refresh = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockRejectedValueOnce(new Error("temporary network failure"));
    await act(async () => root.render(<Harness refresh={refresh} intervalMs={2_000} />));

    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finishFirst?.());
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
