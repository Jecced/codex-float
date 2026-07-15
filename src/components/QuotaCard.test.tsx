// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot, WidgetPreferences } from "../types";
import { QuotaCard } from "./QuotaCard";

const snapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74.567, resetsAt: "2026-07-13T12:00:00Z", windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42.345, resetsAt: "2026-07-19T00:00:00Z", windowSeconds: 604_800 },
  resetCredits: 0,
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

const preferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: "codex",
  autoRotateSeconds: 12,
  language: "en",
  localActivityStats: false,
  weeklyOnly: true,
  showPercentageDecimals: true,
};

const callbacks = {
  providerCount: 1,
  onPrevious: () => undefined,
  onNext: () => undefined,
  onTogglePin: () => undefined,
  onLock: () => undefined,
  onLanguage: () => undefined,
  onDrag: () => undefined,
  onHover: () => undefined,
};

describe("quota display preferences", () => {
  it("shows the weekly window with two decimal places by default", () => {
    const { container, getAllByLabelText } = render(<QuotaCard snapshot={snapshot} preferences={preferences} {...callbacks} />);
    expect(getAllByLabelText("Weekly quota remaining 42.35%").length).toBeGreaterThan(0);
    expect(container.querySelector(".primary-metric")?.textContent).toBe("42.35%");
  });

  it("restores the short primary and weekly secondary layout", () => {
    const { container, getAllByLabelText } = render(<QuotaCard snapshot={snapshot} preferences={{ ...preferences, weeklyOnly: false }} {...callbacks} />);
    expect(getAllByLabelText("5-hour quota remaining 74.57%").length).toBeGreaterThan(0);
    expect(container.querySelector(".primary-metric")?.textContent).toBe("74.57%");
    expect(container.querySelector(".weekly-metric__value")?.textContent).toBe("42.35%");
  });

  it("uses whole percentages when decimal display is disabled", () => {
    const { container } = render(<QuotaCard snapshot={snapshot} preferences={{ ...preferences, showPercentageDecimals: false }} {...callbacks} />);
    expect(container.querySelector(".primary-metric")?.textContent).toBe("42%");
    expect(container.querySelector(".primary-metric .quota-percent__fraction")).toBeNull();
  });

  it("expands the widget only while reset credit details are visible", () => {
    const onCreditTipChange = vi.fn();
    const creditSnapshot = { ...snapshot, resetCredits: 1, resetCreditExpiresAt: ["2026-07-20T00:00:00Z"] };
    const { getByRole } = render(<QuotaCard snapshot={creditSnapshot} preferences={preferences} {...callbacks} onCreditTipChange={onCreditTipChange} />);
    const button = getByRole("button", { name: "View" });

    fireEvent.click(button);
    expect(onCreditTipChange).toHaveBeenLastCalledWith(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(button);
    expect(onCreditTipChange).toHaveBeenLastCalledWith(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
