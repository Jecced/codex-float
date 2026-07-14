import { copy, normalizeLanguage } from "./i18n";
import type { Language, ProviderSnapshot, UsageWindow } from "../types";

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function formatPercent(value: number, decimalPlaces: 0 | 2): string {
  const factor = 10 ** decimalPlaces;
  const scaled = clampPercent(value) * factor;
  const corrected = scaled + Number.EPSILON * Math.abs(scaled) * 2;
  return (Math.round(corrected) / factor).toFixed(decimalPlaces);
}

export function quotaTier(percent: number | null): "unknown" | "healthy" | "caution" | "critical" {
  if (percent === null) return "unknown";
  if (percent >= 50) return "healthy";
  if (percent >= 10) return "caution";
  return "critical";
}

export function displayedQuotaWindow(snapshot: ProviderSnapshot): UsageWindow | null {
  return snapshot.weeklyWindow ?? snapshot.shortWindow;
}

export function isWeeklyQuotaWindow(window: UsageWindow | null): boolean {
  return window !== null && Math.abs(window.windowSeconds - 604_800) <= 60;
}

export function formatResetTime(value: string | null, now = new Date(), language: Language = "zh-CN"): string {
  const t = copy[normalizeLanguage(language)];
  if (!value) return t.resetTimeUnknown;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return t.resetTimeUnknown;
  const delta = target.getTime() - now.getTime();
  if (delta <= 0) return t.resetUpdating;
  const minutes = Math.ceil(delta / 60_000);
  let relative: string;
  if (minutes < 60) {
    relative = t.resetInMinutes(minutes);
  } else {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    relative = hours < 24
      ? t.resetInHours(hours, rest)
      : t.resetInDays(Math.floor(hours / 24), hours % 24);
  }
  const absolute = new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(target);
  return `${relative} · ${absolute}`;
}

export function formatCompactResetTime(value: string | null, now = new Date(), language: Language = "zh-CN"): string {
  const isEnglish = normalizeLanguage(language) === "en";
  if (!value) return isEnglish ? "Unknown" : "未知";
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return isEnglish ? "Unknown" : "未知";
  const delta = target.getTime() - now.getTime();
  if (delta <= 0) return isEnglish ? "Updating" : "更新中";
  const minutes = Math.ceil(delta / 60_000);
  if (minutes < 60) return isEnglish ? `${minutes}m` : `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) {
    if (isEnglish) return rest ? `${hours}h ${rest}m` : `${hours}h`;
    return rest ? `${hours}时${rest}分` : `${hours}小时`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (isEnglish) return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
  return remainingHours ? `${days}天${remainingHours}时` : `${days}天`;
}

export function needsFastRefresh(snapshot: ProviderSnapshot, now = new Date()): boolean {
  const reset = displayedQuotaWindow(snapshot)?.resetsAt;
  if (!reset) return false;
  const remaining = new Date(reset).getTime() - now.getTime();
  return remaining > -5 * 60_000 && remaining <= 15 * 60_000;
}

export function formatResetDate(value: string | null, language: Language = "zh-CN"): string {
  const t = copy[normalizeLanguage(language)];
  if (!value) return t.dateUnknown;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDate) {
    return `${Number(isoDate[2])}/${Number(isoDate[3])}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t.dateUnknown;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function formatDateTime(value: string, language: Language): string {
  const t = copy[normalizeLanguage(language)];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t.creditExpiresUnknown;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
