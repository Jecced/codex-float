import { ArrowClockwise, ArrowDown, ArrowUp, ClockCounterClockwise, CloudSlash, PushPin, PushPinSlash, SignIn, WarningCircle } from "@phosphor-icons/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { clampPercent, displayedQuotaWindow, formatCompactResetTime, formatDateTime, formatPercent, formatResetDate, formatResetTime, isWeeklyQuotaWindow, quotaTier } from "../lib/format";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { Language, LocalActivityStats, ProviderSnapshot, WidgetPreferences } from "../types";
import { ProviderMark } from "./ProviderMark";

interface Props {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  providerCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePin: () => void;
  onLock: () => void;
  onLanguage: () => void;
  onDrag: () => void;
  onHover: (hovered: boolean) => void;
  onRefresh?: () => void;
  isConsuming?: boolean;
  notice?: string | null;
  initialShowCreditTip?: boolean;
  expanded?: boolean;
  localActivity?: LocalActivityStats;
}

function StatusIcon({ status, expired = false }: { status: ProviderSnapshot["status"]; expired?: boolean }) {
  if (status === "signed_out") return <SignIn weight="duotone" />;
  if (status === "stale" || expired) return <ClockCounterClockwise weight="duotone" />;
  if (status === "unavailable") return <CloudSlash weight="duotone" />;
  return <WarningCircle weight="duotone" />;
}

function localizedBackendMessage(message: string | null, language: Language): string | null {
  if (!message) return null;
  if (language === "en") return message;
  const normalized = message.toLowerCase();
  if (normalized.includes("sign in") || normalized.includes("login")) return "Codex 登录已失效，请重新登录。";
  if (normalized.includes("rate limited")) return "请求过于频繁，将稍后自动重试。";
  if (normalized.includes("network")) return "网络不可用，将自动重试。";
  if (normalized.includes("format")) return "额度响应格式已变化。";
  if (normalized.includes("supported quota window")) return "额度响应缺少可识别的周额度窗口。";
  if (normalized.includes("missing the 5h")) return "额度响应缺少 5 小时窗口。";
  if (normalized.includes("refresh is already running")) return "额度正在刷新，请稍候。";
  return message;
}

function QuotaPercent({ value, label, className = "", showDecimals = true }: { value: number; label: string; className?: string; showDecimals?: boolean }) {
  const [integer, fraction] = formatPercent(value, showDecimals ? 2 : 0).split(".");
  return (
    <section className={`quota-percent ${className}`} aria-label={label}>
      <span className="quota-percent__integer">{integer}</span>
      {showDecimals && fraction ? <span className="quota-percent__fraction">.{fraction}</span> : null}
      <small className="quota-percent__unit">%</small>
    </section>
  );
}

function compactNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function activeDuration(value: string | null, language: Language): string {
  if (!value) return "";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return language === "en" ? "<1m" : "<1分";
  if (elapsedMinutes < 60) return language === "en" ? `${elapsedMinutes}m` : `${elapsedMinutes}分`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (language === "en") return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return minutes ? `${hours}时${minutes}分` : `${hours}小时`;
}

export const QuotaCard = memo(function QuotaCard({
  snapshot,
  preferences,
  providerCount,
  onPrevious,
  onNext,
  onTogglePin: _onTogglePin,
  onLock,
  onLanguage,
  onDrag,
  onHover,
  onRefresh,
  isConsuming = false,
  notice = null,
  initialShowCreditTip = false,
  expanded = true,
  localActivity,
}: Props) {
  const [showCreditTip, setShowCreditTip] = useState(initialShowCreditTip);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const quotaWindow = preferences.weeklyOnly
    ? displayedQuotaWindow(snapshot)
    : snapshot.shortWindow ?? displayedQuotaWindow(snapshot);
  const primary = quotaWindow ? clampPercent(quotaWindow.remainingPercent) : null;
  const isWeeklyQuota = quotaWindow === snapshot.weeklyWindow || isWeeklyQuotaWindow(quotaWindow);
  const secondaryWeeklyWindow = !preferences.weeklyOnly
    && snapshot.shortWindow !== null
    && !isWeeklyQuotaWindow(snapshot.shortWindow)
    ? snapshot.weeklyWindow
    : null;
  const secondaryWeekly = secondaryWeeklyWindow ? clampPercent(secondaryWeeklyWindow.remainingPercent) : null;
  const labelPercent = primary === null ? null : Number(formatPercent(primary, preferences.showPercentageDecimals ? 2 : 0));
  const quotaLabel = primary === null
    ? t.unavailableStatus
    : isWeeklyQuota
      ? t.weeklyAvailableLabel(labelPercent ?? primary)
      : t.availableLabel(labelPercent ?? primary);
  const staleAge = Date.now() - new Date(snapshot.updatedAt).getTime();
  const staleExpired = snapshot.status === "stale" && staleAge > 30 * 60_000;
  const available = snapshot.status === "ok" || (snapshot.status === "stale" && !staleExpired);
  const tier = quotaTier(primary);
  const localStatsAvailable = localActivity?.enabled === true && localActivity.available;
  const locallyActive = localStatsAvailable && localActivity.isActive;
  const indicatorState = locallyActive || isConsuming ? "active" : snapshot.status === "ok" ? "ok" : snapshot.status === "stale" ? "stale" : "error";
  const indicatorLabel = locallyActive || isConsuming
    ? t.active
    : snapshot.status === "ok"
      ? t.dataSynced
      : snapshot.status === "stale"
        ? t.dataStale
        : snapshot.status === "signed_out"
          ? t.notSignedIn
          : t.unavailableStatus;
  const message = localizedBackendMessage(snapshot.message, language);
  const resetNow = new Date();
  const resetAt = quotaWindow?.resetsAt ?? null;
  const creditExpirations = useMemo(() => (snapshot.resetCreditExpiresAt ?? []).map((value, index) => {
    return t.creditItem(index, formatDateTime(value, language));
  }), [language, snapshot.resetCreditExpiresAt, t]);

  return (
    <main
      className={`quota-card quota-card--${snapshot.status} quota-card--${tier} ${expanded ? "quota-card--expanded" : "quota-card--compact"}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
    >
      <div className="aurora" aria-hidden="true" />
      <span className="sr-only" aria-live="polite">{available && primary !== null ? quotaLabel : message}</span>
      <div className="card-content" aria-hidden={!expanded}>
        {notice ? <p className="operation-notice" role="status">{notice}</p> : null}
        <header className="card-header">
          <div>
            <p className="eyebrow">{snapshot.displayName} · {snapshot.plan ?? t.accountFallback}</p>
            {snapshot.status !== "stale" ? <p className="updated">{isWeeklyQuota ? t.weeklyRemaining : t.shortRemaining}</p> : null}
          </div>
          {!preferences.locked ? (
            <nav className="card-actions" aria-label={t.controls} onMouseDown={(event) => event.stopPropagation()}>
              {providerCount > 1 ? <button onClick={onPrevious} aria-label={t.servicePrevious}><ArrowUp /></button> : null}
              {providerCount > 1 ? <button onClick={onNext} aria-label={t.serviceNext}><ArrowDown /></button> : null}
              <span className={`usage-indicator usage-indicator--${indicatorState}`} role="status" aria-label={indicatorLabel} title={indicatorLabel}><i /></span>
              <button className="language-button" onClick={onLanguage} aria-label={t.switchLanguage} title={t.switchLanguage}>{language === "en" ? "中" : "EN"}</button>
              <button onClick={onLock} aria-label={preferences.alwaysOnTop ? t.pinOff : t.pinOn} title={preferences.alwaysOnTop ? t.pinOff : t.pinOn}>
                {preferences.alwaysOnTop ? <PushPin /> : <PushPinSlash />}
              </button>
            </nav>
          ) : null}
        </header>

        {available && primary !== null ? (
          <>
          <div className="progress" role="progressbar" aria-label={quotaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={primary}>
            <span style={{ width: `${primary}%` }} />
          </div>
          {localStatsAvailable ? (
            <section className="activity-stats" aria-label={locallyActive ? t.localWorking : t.localIdle}>
              <span className={`activity-stat activity-stat--state${locallyActive ? " is-active" : ""}`}>
                <i aria-hidden="true" />
                <small>{locallyActive ? t.localWorking : t.localIdle}</small>
                <strong>{locallyActive ? activeDuration(localActivity.activeSince, language) : ""}</strong>
              </span>
              <span className="activity-stat">
                <small>{t.todayTokens}</small>
                <strong>{compactNumber(localActivity.todayNewTokens, language)}</strong>
              </span>
              <span className="activity-stat">
                <small>{t.contextUsage}</small>
                <strong>{localActivity.contextPercent === null ? "--" : `${Math.round(localActivity.contextPercent)}%`}</strong>
              </span>
            </section>
          ) : null}
          <footer className="card-footer">
            <div className={secondaryWeeklyWindow ? "weekly-metric" : "quota-meta"}>
              {secondaryWeeklyWindow && secondaryWeekly !== null ? (
                <>
                  <p>{t.weeklyUntil(formatResetDate(secondaryWeeklyWindow.resetsAt, language))}</p>
                  <QuotaPercent
                    value={secondaryWeekly}
                    label={t.weeklyAvailableLabel(Number(formatPercent(secondaryWeekly, preferences.showPercentageDecimals ? 2 : 0)))}
                    className="weekly-metric__value"
                    showDecimals={preferences.showPercentageDecimals}
                  />
                </>
              ) : null}
              <div className="reset-credit-row" onMouseDown={(event) => event.stopPropagation()}>
                <span>{snapshot.resetCredits === null ? t.resetCreditUnknown : t.resetCredits(snapshot.resetCredits)}</span>
                {snapshot.resetCredits !== null && snapshot.resetCredits > 0 ? (
                  <button type="button" className="reset-credit-button" onClick={() => setShowCreditTip((value) => !value)} aria-expanded={showCreditTip} aria-label={t.view}>{t.view}</button>
                ) : null}
              </div>
              {showCreditTip ? (
                <div className="reset-credit-tip" role="status" onMouseDown={(event) => event.stopPropagation()}>
                  {creditExpirations.length > 0 ? creditExpirations.map((item) => <p key={item}>{item}</p>) : <p>{t.noCreditExpiration}</p>}
                </div>
              ) : null}
            </div>
            <ProviderMark />
          </footer>
          </>
        ) : (
          <section className="error-state" aria-live="polite">
            <div className="status-icon" aria-hidden="true"><StatusIcon status={snapshot.status} expired={staleExpired} /></div>
            <strong>{snapshot.status === "signed_out" ? t.signedInRequired : staleExpired ? t.staleExpired : t.temporarilyUnavailable}</strong>
            <p>{message ?? t.errorUnavailable}</p>
            {snapshot.status === "stale" ? (
              <button type="button" className="error-refresh-button" onMouseDown={(event) => event.stopPropagation()} onClick={onRefresh} disabled={!onRefresh} aria-label={t.refreshQuota}>
                <ArrowClockwise />
                <span>{t.refresh}</span>
              </button>
            ) : null}
          </section>
        )}
      </div>
      {available && primary !== null ? (
        <>
          <QuotaPercent value={primary} label={quotaLabel} className="primary-metric" showDecimals={preferences.showPercentageDecimals} />
          <p className="reset-time">
            <span className="reset-time__full">{formatResetTime(resetAt, resetNow, language)}</span>
            <span className="reset-time__compact">{formatCompactResetTime(resetAt, resetNow, language)}</span>
          </p>
        </>
      ) : (
        <section className="compact-status" aria-hidden={expanded}><StatusIcon status={snapshot.status} expired={staleExpired} /></section>
      )}
      <span className={`compact-activity${locallyActive ? " is-active" : ""}`} aria-label={locallyActive ? t.localWorking : t.localIdle}><i /></span>
    </main>
  );
});

export const QuotaOrb = memo(function QuotaOrb({ snapshot, onDrag, onHover, language = "zh-CN", weeklyOnly = true, showPercentageDecimals = true }: Pick<Props, "snapshot" | "onDrag" | "onHover"> & { language?: Language; weeklyOnly?: boolean; showPercentageDecimals?: boolean }) {
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const activeLanguage = normalizeLanguage(language);
  const t = copy[activeLanguage];
  const quotaWindow = weeklyOnly ? displayedQuotaWindow(snapshot) : snapshot.shortWindow ?? displayedQuotaWindow(snapshot);
  const primary = quotaWindow ? clampPercent(quotaWindow.remainingPercent) : null;
  const labelPercent = primary === null ? null : Number(formatPercent(primary, showPercentageDecimals ? 2 : 0));
  const quotaLabel = primary === null
    ? t.unavailableStatus
    : quotaWindow === snapshot.weeklyWindow || isWeeklyQuotaWindow(quotaWindow)
      ? t.weeklyAvailableLabel(labelPercent ?? primary)
      : t.availableLabel(labelPercent ?? primary);
  const tier = quotaTier(primary);
  const available = snapshot.status === "ok" && primary !== null;

  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    setIdle(false);
    onHover(true);
  };

  return (
    <main
      className={`quota-orb quota-card--${snapshot.status} quota-card--${tier}${idle ? " quota-orb--idle" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => onHover(false)}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
      aria-label={available ? quotaLabel : localizedBackendMessage(snapshot.message, activeLanguage) ?? t.unavailableStatus}
    >
      <div className="aurora" aria-hidden="true" />
      {available ? (
        <QuotaPercent value={primary} label={quotaLabel} className="orb-metric" showDecimals={showPercentageDecimals} />
      ) : (
        <section className="orb-unavailable">
          <StatusIcon status={snapshot.status} />
        </section>
      )}
    </main>
  );
});
