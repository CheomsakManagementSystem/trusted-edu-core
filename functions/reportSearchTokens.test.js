"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildReportSearchTokens,
  normalizeReportSearchQuery,
} = require("./reportSearchTokens");

describe("report search tokens", () => {
  it("normalizes spaces, punctuation and letter case", () => {
    assert.equal(normalizeReportSearchQuery(" 김 민지 (PDF) "), "김민지pdf");
  });

  it("supports name substrings and file-name terms", () => {
    const tokens = buildReportSearchTokens({
      studentName: "김민지",
      fileName: "0506_고려대 24모의.pdf",
    });

    assert.equal(tokens.includes("민지"), true);
    assert.equal(tokens.includes("고려대"), true);
    assert.equal(tokens.includes("24모의"), true);
  });

  it("keeps the indexed array bounded", () => {
    const tokens = buildReportSearchTokens({ fileName: "가".repeat(500) });
    assert.equal(tokens.length <= 480, true);
  });
});
