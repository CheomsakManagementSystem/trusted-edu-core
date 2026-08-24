const MAX_TOKEN_LENGTH = 24;

export type ReportSearchSource = {
  studentName?: string | null;
  sourceName?: string | null;
  fileName?: string | null;
  essayTopic?: string | null;
  reviewer?: string | null;
};

const SEARCH_FIELDS: Array<{ key: keyof ReportSearchSource; limit: number }> = [
  { key: "studentName", limit: 64 },
  { key: "sourceName", limit: 64 },
  { key: "fileName", limit: 256 },
  { key: "essayTopic", limit: 64 },
  { key: "reviewer", limit: 32 },
];

export const normalizeReportSearchQuery = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const buildFieldTokens = (value: unknown, limit: number): string[] => {
  const source = String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR");
  const normalized = normalizeReportSearchQuery(source);
  if (!normalized) return [];

  const tokens = new Set<string>();
  const candidates = [
    normalized,
    ...source
      .split(/[^\p{L}\p{N}]+/gu)
      .map(normalizeReportSearchQuery)
      .filter(Boolean),
  ];

  const add = (token: string) => {
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

export const buildReportSearchTokens = (source: ReportSearchSource): string[] => {
  const tokens = new Set<string>();
  SEARCH_FIELDS.forEach(({ key, limit }) => {
    buildFieldTokens(source[key], limit).forEach((token) => tokens.add(token));
  });
  return [...tokens].sort((a, b) => a.length - b.length || a.localeCompare(b, "ko"));
};

export const reportMatchesSearchQuery = (
  source: ReportSearchSource,
  query: string,
): boolean => {
  const normalized = normalizeReportSearchQuery(query);
  if (!normalized) return true;
  return SEARCH_FIELDS.some(({ key }) =>
    normalizeReportSearchQuery(source[key]).includes(normalized),
  );
};
