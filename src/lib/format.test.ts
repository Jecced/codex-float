import { describe, expect, it } from "vitest";
import { clampPercent, displayedQuotaWindow, formatCompactResetTime, formatPercent, formatResetDate, formatResetTime, isWeeklyQuotaWindow, needsFastRefresh, quotaTier } from "./format";

describe("quota formatting", () => {
  it("clamps untrusted percentages", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(51.678)).toBe(51.678);
    expect(clampPercent(140)).toBe(100);
  });

  it("formats percentages with conventional decimal rounding", () => {
    expect(formatPercent(42.345, 2)).toBe("42.35");
    expect(formatPercent(99, 2)).toBe("99.00");
    expect(formatPercent(42.345, 0)).toBe("42");
  });

  it("uses inclusive 50% and 10% quota boundaries", () => {
    expect(quotaTier(50)).toBe("healthy");
    expect(quotaTier(49)).toBe("caution");
    expect(quotaTier(10)).toBe("caution");
    expect(quotaTier(9)).toBe("critical");
    expect(quotaTier(null)).toBe("unknown");
  });

  it("formats reset time in Chinese by default and supports English", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    expect(formatResetTime("2026-07-07T01:30:00Z", now)).toBe("1 小时 30 分钟后重置");
    expect(formatResetTime("2026-07-07T01:30:00Z", now, "zh-CN")).toBe("1 小时 30 分钟后重置");
    expect(formatResetTime("2026-07-07T01:30:00Z", now, "en")).toBe("resets in 1h 30m");
    expect(formatResetTime("2026-07-06T01:00:00Z", now)).toBe("正在更新额度");
    expect(formatResetTime("2026-07-06T01:00:00Z", now, "zh-CN")).toBe("正在更新额度");
    expect(formatResetTime("2026-07-06T01:00:00Z", now, "en")).toBe("Updating quota");
    expect(formatResetTime("invalid", now)).toBe("重置时间未知");
    expect(formatResetTime("invalid", now, "zh-CN")).toBe("重置时间未知");
    expect(formatResetTime("invalid", now, "en")).toBe("Reset time unknown");
  });

  it("uses a compact reset time in the collapsed widget", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    expect(formatCompactResetTime("2026-07-07T01:30:00Z", now)).toBe("1时30分");
    expect(formatCompactResetTime("2026-07-07T01:30:00Z", now, "en")).toBe("1h 30m");
    expect(formatCompactResetTime("2026-07-07T00:08:00Z", now)).toBe("8分");
    expect(formatCompactResetTime("2026-07-09T03:00:00Z", now)).toBe("2天3时");
    expect(formatCompactResetTime("invalid", now)).toBe("未知");
  });

  it("accelerates only near a future reset", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    const snapshot = { provider: "codex", displayName: "CODEX", plan: "PRO", shortWindow: null, resetCredits: 0, updatedAt: now.toISOString(), status: "ok", message: null } as const;
    expect(needsFastRefresh({ ...snapshot, weeklyWindow: { remainingPercent: 1, resetsAt: "2026-07-07T00:10:00Z", windowSeconds: 604800 } }, now)).toBe(true);
    expect(needsFastRefresh({ ...snapshot, weeklyWindow: { remainingPercent: 1, resetsAt: "2026-07-07T01:00:00Z", windowSeconds: 604800 } }, now)).toBe(false);
    expect(needsFastRefresh({ ...snapshot, weeklyWindow: { remainingPercent: 1, resetsAt: "2026-07-06T23:58:00Z", windowSeconds: 604800 } }, now)).toBe(true);
  });

  it("prefers the weekly window and falls back to the short window", () => {
    const shortWindow = { remainingPercent: 74, resetsAt: null, windowSeconds: 18_000 };
    const weeklyWindow = { remainingPercent: 42, resetsAt: null, windowSeconds: 604_800 };
    const snapshot = { provider: "codex", displayName: "CODEX", plan: "PRO", shortWindow, weeklyWindow, resetCredits: 0, updatedAt: new Date().toISOString(), status: "ok", message: null } as const;
    expect(displayedQuotaWindow(snapshot)).toBe(weeklyWindow);
    expect(displayedQuotaWindow({ ...snapshot, weeklyWindow: null })).toBe(shortWindow);
    expect(isWeeklyQuotaWindow(weeklyWindow)).toBe(true);
    expect(isWeeklyQuotaWindow(shortWindow)).toBe(false);
  });

  it("formats the weekly reset as a compact date", () => {
    expect(formatResetDate("2026-07-10T00:00:00+08:00")).toBe("7/10");
    expect(formatResetDate("2026-07-10T00:00:00+08:00", "en")).toBe("7/10");
    expect(formatResetDate(null)).toBe("日期未知");
    expect(formatResetDate(null, "zh-CN")).toBe("日期未知");
    expect(formatResetDate(null, "en")).toBe("Date unknown");
  });
});
