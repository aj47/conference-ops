import { useEffect, useRef } from "react";

export const WORKSPACE_REFRESH_INTERVAL_MS = 25_000;

const authenticatedWorkspaceRoute = /^\/(?:workspace|forms|proposals|reviews|schedule|speaker-ops|publish|portal)(?:\/|$)/;

/** Routes whose data comes from the authenticated workspace bootstrap. */
export function isAuthenticatedWorkspacePath(pathname: string) {
  return pathname === "/" || authenticatedWorkspaceRoute.test(pathname);
}

/** Keep local form-builder work while accepting server state everywhere else. */
export function preserveUnsavedBuilder<T extends { dirty: boolean }>(
  current: T,
  hydrated: T | undefined,
) {
  return current.dirty || !hydrated ? current : hydrated;
}

interface VisibleWorkspaceRefreshOptions {
  enabled: boolean;
  refreshKey: string;
  refresh: () => Promise<void>;
  intervalMs?: number;
}

/**
 * Bounded collaboration refresh for authenticated workspaces. It deliberately
 * stays quiet: the initial bootstrap owns loading/error UI, while background
 * failures are retried at the next interval or when the tab becomes active.
 */
export function useVisibleWorkspaceRefresh({
  enabled,
  refreshKey,
  refresh,
  intervalMs = WORKSPACE_REFRESH_INTERVAL_MS,
}: VisibleWorkspaceRefreshOptions) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") return;

    let disposed = false;
    let inFlight = false;
    let lastAttemptAt = 0;

    const run = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      const now = Date.now();
      // Browsers commonly dispatch visibilitychange and focus together.
      if (now - lastAttemptAt < 1_000) return;
      lastAttemptAt = now;
      inFlight = true;
      try {
        await refreshRef.current();
      } catch {
        // Transient background failures must not disrupt the active workflow.
      } finally {
        inFlight = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void run();
    };

    const interval = window.setInterval(() => void run(), intervalMs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [enabled, intervalMs, refreshKey]);
}
