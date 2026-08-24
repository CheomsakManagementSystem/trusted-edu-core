import { describe, expect, it } from "vitest";
import {
  buildReportSearchTokens,
  normalizeReportSearchQuery,
  reportMatchesSearchQuery,
} from "@/lib/reportSearchTokens";

describe("reportSearchTokens", () => {
  it("normalizes case, spacing, punctuation, and compatibility characters", () => {
    expect(normalizeReportSearchQuery("  Ｋim 민-지.PDF ")).toBe("kim민지pdf");
  });

  it("indexes common student-name and file-name substrings", () => {
    const tokens = buildReportSearchTokens({
      studentName: "김 민지",
      fileName: "2026 고려대 모의논술.pdf",
    });

    expect(tokens).toContain("김민지");
    expect(tokens).toContain("민지");
    expect(tokens).toContain("고려대");
    expect(tokens).toContain("모의논술");
  });

  it("keeps the indexed array bounded", () => {
    const longValue = "가나다라마바사아자차카타파하".repeat(20);
    const tokens = buildReportSearchTokens({
      studentName: longValue,
      sourceName: longValue,
      fileName: longValue,
      essayTopic: longValue,
      reviewer: longValue,
    });

    expect(tokens.length).toBeLessThanOrEqual(480);
    expect(tokens).toContain(normalizeReportSearchQuery(longValue));
  });

  it("preserves normalized substring matching for the rendered page", () => {
    const report = {
      studentName: "김 민지",
      sourceName: "김민지",
      fileName: "고려대_모의.pdf",
      essayTopic: "인문 논술",
      reviewer: "홍길동",
    };

    expect(reportMatchesSearchQuery(report, "김민지")).toBe(true);
    expect(reportMatchesSearchQuery(report, "고려대 모의")).toBe(true);
    expect(reportMatchesSearchQuery(report, "자연계")).toBe(false);
  });
});
