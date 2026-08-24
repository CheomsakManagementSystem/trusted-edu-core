"use strict";

const MAX_TOKEN_LENGTH = 24;
const SEARCH_FIELDS = [
  ["studentName", 64],
  ["sourceName", 64],
  ["fileName", 256],
  ["essayTopic", 64],
  ["reviewer", 32],
];

const normalizeReportSearchQuery = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const buildFieldTokens = (value, limit) => {
  const source = String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR");
  const normalized = normalizeReportSearchQuery(source);
  if (!normalized) return [];

  const tokens = new Set();
  const candidates = [
    normalized,
    ...source
      .split(/[^\p{L}\p{N}]+/gu)
      .map(normalizeReportSearchQuery)
      .filter(Boolean),
  ];
  const add = (token) => {
    if (token && tokens.size < limit) tokens.add(token);
  };

  for (const candidate of candidates) {
    add(candidate);
    const maxLength = Math.min(candidate.length, MAX_TOKEN_LENGTH);
    for (let length = 1; length <= maxLength && tokens.size < limit; length += 1) {
      add(candidate.slice(0, length));
      add(candidate.slice(-length));
    }
  }

  for (let length = 1; length <= Math.min(normalized.length, MAX_TOKEN_LENGTH); length += 1) {
    for (let start = 0; start + length <= normalized.length; start += 1) {
      add(normalized.slice(start, start + length));
      if (tokens.size >= limit) return [...tokens];
    }
  }
  return [...tokens];
};

const buildReportSearchTokens = (source) => {
  const tokens = new Set();
  SEARCH_FIELDS.forEach(([key, limit]) => {
    buildFieldTokens(source?.[key], limit).forEach((token) => tokens.add(token));
  });
  return [...tokens].sort((a, b) => a.length - b.length || a.localeCompare(b, "ko"));
};

module.exports = {
  buildReportSearchTokens,
  normalizeReportSearchQuery,
};
