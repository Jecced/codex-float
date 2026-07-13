import type { LocalActivityStats, ProviderSnapshot, WidgetPreferences } from "../types";

const defaultPreferences: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", localActivityStats: true, weeklyOnly: true, showPercentageDecimals: true };
let widgetResizeAnimation = 0;

const WIDGET_ANIMATION_MS = 300;

// Matches CSS cubic-bezier(.22, 1, .36, 1) so the web content and native
// window settle on the same frame instead of visibly drifting apart.
function widgetEase(progress: number): number {
  const x1 = 0.22;
  const y1 = 1;
  const x2 = 0.36;
  const y2 = 1;
  let parameter = progress;

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const inverse = 1 - parameter;
    const x = 3 * inverse * inverse * parameter * x1
      + 3 * inverse * parameter * parameter * x2
      + parameter * parameter * parameter;
    const derivative = 3 * inverse * inverse * x1
      + 6 * inverse * parameter * (x2 - x1)
      + 3 * parameter * parameter * (1 - x2);
    if (Math.abs(derivative) < 0.0001) break;
    parameter -= (x - progress) / derivative;
  }

  const clamped = Math.min(1, Math.max(0, parameter));
  const inverse = 1 - clamped;
  return 3 * inverse * inverse * clamped * y1
    + 3 * inverse * clamped * clamped * y2
    + clamped * clamped * clamped;
}

const mockSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: null,
  weeklyWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

const mockLocalActivity: LocalActivityStats = {
  enabled: true,
  available: true,
  isActive: true,
  activeSince: new Date(Date.now() - 2 * 60_000).toISOString(),
  todayNewTokens: 86_400,
  contextPercent: 33,
  updatedAt: new Date().toISOString(),
};

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function fetchSnapshots(force = false): Promise<ProviderSnapshot[]> {
  if (!isTauri()) return [mockSnapshot];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot[]>(force ? "refresh_snapshots" : "get_snapshots");
}

export async function fetchLocalActivityStats(): Promise<LocalActivityStats> {
  if (!isTauri()) return mockLocalActivity;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LocalActivityStats>("get_local_activity_stats");
}

export async function getPreferences(): Promise<WidgetPreferences> {
  if (!isTauri()) return defaultPreferences;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("get_preferences");
}

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_preferences", { preferences: value });
}

export async function setClickThrough(locked: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, locked };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_locked", { locked });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, alwaysOnTop };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_always_on_top", { alwaysOnTop });
}

export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function setWidgetExpanded(expanded: boolean): Promise<void> {
  const animation = ++widgetResizeAnimation;
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  const targetSize = expanded ? 320 : 100;
  const startWidth = window.innerWidth || targetSize;
  const startHeight = window.innerHeight || targetSize;
  const duration = WIDGET_ANIMATION_MS;

  const applyFrame = (width: number, height: number) => appWindow.setSize(new LogicalSize(width, height));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (animation === widgetResizeAnimation) {
      await applyFrame(targetSize, targetSize);
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const startedAt = performance.now();
    let settled = false;
    let applyingFrame = false;
    let pendingFrame: { width: number; height: number; final: boolean } | null = null;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const flushLatestFrame = () => {
      if (settled || applyingFrame || !pendingFrame) return;
      const frame = pendingFrame;
      pendingFrame = null;
      applyingFrame = true;

      void applyFrame(frame.width, frame.height).then(() => {
        applyingFrame = false;
        if (settled) return;
        if (pendingFrame) {
          flushLatestFrame();
        } else if (frame.final) {
          settled = true;
          resolve();
        }
      }).catch(fail);
    };

    const step = (now: number) => {
      if (animation !== widgetResizeAnimation) {
        if (!settled) {
          settled = true;
          resolve();
        }
        return;
      }

      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = widgetEase(progress);
      const width = startWidth + (targetSize - startWidth) * eased;
      const height = startHeight + (targetSize - startHeight) * eased;
      const finalFrame = progress >= 1;

      // Keep requestAnimationFrame independent from IPC latency, while
      // coalescing delayed calls so native resize commands never pile up.
      pendingFrame = { width, height, final: finalFrame };
      flushLatestFrame();

      if (!finalFrame) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

export async function listenDesktopEvents(handlers: {
  onPreferences: (value: WidgetPreferences) => void;
  onRefresh: () => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  return () => { unlistenPreferences(); unlistenRefresh(); };
}
