import { describe, expect, it } from "vitest";
import { detectLocale, formatDate, formatExactDate, resolveLocale, translate } from "./i18n.js";

describe("Web I18N", () => {
  it("selects Simplified Chinese for Chinese browser locales", () => {
    expect(detectLocale(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(detectLocale(["en-US"])).toBe("en");
  });

  it("accepts only supported persisted locales", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("fr-FR")).toBeNull();
  });

  it("translates Chinese interface text with English fallback", () => {
    expect(translate("zh-CN", "New initiative")).toBe("新建项目");
    expect(translate("zh-CN", "{count} need attention", { count: 3 })).toBe("3 项需要关注");
    expect(translate("zh-CN", "Refreshing…")).toBe("正在刷新…");
    expect(translate("zh-CN", "Retry")).toBe("重试");
    expect(translate("zh-CN", "Untranslated label")).toBe("Untranslated label");
    expect(translate("en", "New initiative")).toBe("New initiative");
  });

  it("formats relative dates in the selected language", () => {
    const now = Date.UTC(2026, 6, 19, 2, 0, 0);
    const thirtyMinutesAgo = new Date(now - 30 * 60 * 1000).toISOString();
    expect(formatDate("zh-CN", thirtyMinutesAgo, now)).toBe("30 分钟前");
    expect(formatDate("en", thirtyMinutesAgo, now)).toBe("30 min ago");
  });

  it("formats timestamps with locale-aware date and minute precision", () => {
    expect(formatExactDate("2026-07-19T02:05:42.000Z", "en")).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s+\d{2}:\d{2}$/);
    expect(formatExactDate("2026-07-19T02:05:42.000Z", "zh-CN")).toMatch(/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}$/);
    expect(formatExactDate(null, "en")).toBe("-");
  });
});
