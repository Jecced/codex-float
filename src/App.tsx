import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuotaCard } from "./components/QuotaCard";
import { fetchLocalActivityStats, fetchSnapshots, getPreferences, listenDesktopEvents, setAlwaysOnTop, setWidgetExpanded, startDragging, updatePreferences } from "./lib/bridge";
import { displayedQuotaWindow, needsFastRefresh } from "./lib/format";
import { copy, nextLanguage, normalizeLanguage } from "./lib/i18n";
import { mergeSnapshots } from "./lib/snapshots";
import type { LocalActivityStats, ProviderSnapshot, WidgetPreferences } from "./types";

const DEFAULT_PREFS: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", localActivityStats: true, weeklyOnly: true, showPercentageDecimals: true };
const EMPTY_LOCAL_ACTIVITY: LocalActivityStats = { enabled: false, available: false, isActive: false, activeSince: null, todayNewTokens: 0, contextPercent: null, updatedAt: new Date(0).toISOString() };

export default function App() {
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [consumingProviders, setConsumingProviders] = useState<Set<string>>(() => new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [localActivity, setLocalActivity] = useState<LocalActivityStats>(EMPTY_LOCAL_ACTIVITY);
  const failures = useRef(0);
  const previousPrimary = useRef(new Map<string, number>());
  const consumptionTimers = useRef(new Map<string, number>());
  const hoverTransition = useRef(0);
  const resizeTransition = useRef(false);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];

  const refresh = useCallback(async (force = false) => {
    try {
      const values = await fetchSnapshots(force);
      const hasFailure = values.some((item) => item.status !== "ok");
      if (hasFailure) failures.current += 1;
      else failures.current = 0;
      for (const item of values) {
        const nextPrimary = displayedQuotaWindow(item)?.remainingPercent;
        const previous = previousPrimary.current.get(item.provider);
        if (nextPrimary !== undefined && previous !== undefined && nextPrimary < previous) {
          setConsumingProviders((current) => new Set(current).add(item.provider));
          const oldTimer = consumptionTimers.current.get(item.provider);
          if (oldTimer !== undefined) window.clearTimeout(oldTimer);
          const timer = window.setTimeout(() => {
            setConsumingProviders((current) => { const next = new Set(current); next.delete(item.provider); return next; });
            consumptionTimers.current.delete(item.provider);
          }, 5 * 60_000);
          consumptionTimers.current.set(item.provider, timer);
        }
        if (nextPrimary !== undefined) previousPrimary.current.set(item.provider, nextPrimary);
      }
      setSnapshots((current) => mergeSnapshots(current, values));
    } catch {
      failures.current += 1;
      setSnapshots((current) => current.length > 0
        ? current.map((item) => ({ ...item, status: "stale", message: "Refresh failed. Please try again later." }))
        : [{ provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, weeklyWindow: null, resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "unavailable", message: "Quota is temporarily unavailable. It will retry automatically." }]);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    void getPreferences().then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => setOperationError("Unable to read settings. Defaults are in use."));
    return () => { for (const timer of consumptionTimers.current.values()) window.clearTimeout(timer); consumptionTimers.current.clear(); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetchLocalActivityStats().then((value) => {
        if (!cancelled) setLocalActivity(value);
      }).catch(() => {
        if (!cancelled) setLocalActivity(EMPTY_LOCAL_ACTIVITY);
      });
    };
    poll();
    const id = window.setInterval(poll, 1500);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [preferences.localActivityStats]);

  useEffect(() => {
    const syncExpandedToWindow = () => {
      if (resizeTransition.current) return;
      setExpanded(window.innerWidth > 120 && window.innerHeight > 120);
    };
    window.addEventListener("resize", syncExpandedToWindow);
    const startupTransition = hoverTransition.current;
    resizeTransition.current = true;
    void setWidgetExpanded(false).then(() => {
      if (hoverTransition.current !== startupTransition) return;
      resizeTransition.current = false;
      setExpanded(false);
    }).catch(() => {
      if (hoverTransition.current === startupTransition) resizeTransition.current = false;
    });
    return () => window.removeEventListener("resize", syncExpandedToWindow);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({ onPreferences: (value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) }), onRefresh: () => void refresh(true) }).then((value) => {
      if (cancelled) value(); else cleanup = value;
    }).catch(() => setOperationError("Desktop event listener failed to start."));
    return () => { cancelled = true; cleanup(); };
  }, [refresh]);

  const refreshMs = useMemo(() => {
    const backoff = failures.current === 0 ? 5 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** (failures.current - 1));
    if (failures.current === 0 && snapshots.some((item) => item.status === "ok" && needsFastRefresh(item))) return 60_000;
    return backoff;
  }, [snapshots]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (hovered || preferences.pinnedProvider || snapshots.length < 2) return;
    const id = window.setInterval(() => setActiveIndex((value) => (value + 1) % snapshots.length), preferences.autoRotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [hovered, preferences.autoRotateSeconds, preferences.pinnedProvider, snapshots.length]);

  const current = preferences.pinnedProvider
    ? snapshots.find((item) => item.provider === preferences.pinnedProvider) ?? snapshots[0]
    : snapshots[activeIndex % Math.max(1, snapshots.length)];

  const savePreferences = useCallback((next: WidgetPreferences) => {
    const previous = preferences;
    setPreferences(next);
    setOperationError(null);
    void updatePreferences(next).catch(() => { setPreferences(previous); setOperationError("Settings could not be saved. Previous state restored."); });
  }, [preferences]);

  const handleHover = useCallback((value: boolean) => {
    const transition = ++hoverTransition.current;
    resizeTransition.current = true;
    setHovered(value);
    setExpanded(value);
    setOperationError(null);
    if (value) void refresh(true);
    void setWidgetExpanded(value).then(() => {
      if (transition !== hoverTransition.current) return;
      resizeTransition.current = false;
      setOperationError(null);
    }).catch(() => {
      if (transition !== hoverTransition.current) return;
      resizeTransition.current = false;
      setExpanded(!value);
      setOperationError(value ? "Widget expand failed." : "Widget collapse failed.");
    });
  }, [refresh]);

  const handleCreditTipChange = useCallback((visible: boolean) => {
    if (!expanded) return;
    setOperationError(null);
    void setWidgetExpanded(true, visible).catch(() => {
      setOperationError(visible ? "Credit details could not be expanded." : "Widget could not be compacted.");
    });
  }, [expanded]);

  if (!current) return <div className="loading-card" aria-label={t.loadingQuota}><span /><span /><span /></div>;

  return (
    <QuotaCard
      snapshot={current}
      preferences={preferences}
      providerCount={snapshots.length}
      onPrevious={() => setActiveIndex((value) => (value - 1 + snapshots.length) % snapshots.length)}
      onNext={() => setActiveIndex((value) => (value + 1) % snapshots.length)}
      onTogglePin={() => savePreferences({ ...preferences, pinnedProvider: preferences.pinnedProvider ? null : current.provider })}
      onLanguage={() => savePreferences({ ...preferences, language: nextLanguage(language) })}
      onLock={() => { setOperationError(null); void setAlwaysOnTop(!preferences.alwaysOnTop).then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => setOperationError("Always-on-top toggle failed.")); }}
      onDrag={() => startDragging()}
      onHover={handleHover}
      onRefresh={() => refresh(true)}
      isConsuming={consumingProviders.has(current.provider)}
      notice={operationError}
      expanded={expanded}
      localActivity={localActivity}
      onCreditTipChange={handleCreditTipChange}
    />
  );
}
