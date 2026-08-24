import {
  normalizeReportSearchQuery,
  reportMatchesSearchQuery,
} from "@/lib/reportSearchTokens";

export const REPORT_ARCHIVE_PAGE_SIZE = 50;

export type ReportArchiveSearchSource = {
  classId?: string | null;
  essayTopic?: string | null;
  fileName?: string | null;
  isRead?: boolean;
  sourceName?: string | null;
  studentName?: string | null;
};

export type ReportArchiveSearchEntry<T extends ReportArchiveSearchSource> = {
  report: T;
};

export type ReportArchiveFilters = {
  classId: string;
  keyword: string;
  readStatus: string;
};

export const normalizeReportArchiveKeyword = (value: string): string =>
  normalizeReportSearchQuery(value);

export const buildReportArchiveSearchIndex = <T extends ReportArchiveSearchSource>(
  reports: T[],
): ReportArchiveSearchEntry<T>[] =>
  reports.map((report) => ({ report }));

export const filterReportArchive = <T extends ReportArchiveSearchSource>(
  entries: ReportArchiveSearchEntry<T>[],
  filters: ReportArchiveFilters,
): T[] => {
  const keyword = normalizeReportArchiveKeyword(filters.keyword);

  return entries
    .filter(({ report }) => {
      if (filters.classId !== "all" && report.classId !== filters.classId) return false;
      if (keyword && !reportMatchesSearchQuery(report, keyword)) return false;
      if (filters.readStatus === "read" && !report.isRead) return false;
      if (filters.readStatus === "unread" && report.isRead) return false;
      return true;
    })
    .map(({ report }) => report);
};

export const getReportArchivePageCount = (
  resultCount: number,
  pageSize = REPORT_ARCHIVE_PAGE_SIZE,
): number => Math.max(1, Math.ceil(resultCount / pageSize));

export const getReportArchivePage = <T>(
  reports: T[],
  requestedPage: number,
  pageSize = REPORT_ARCHIVE_PAGE_SIZE,
): { page: number; reports: T[] } => {
  const pageCount = getReportArchivePageCount(reports.length, pageSize);
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;

  return { page, reports: reports.slice(start, start + pageSize) };
};
