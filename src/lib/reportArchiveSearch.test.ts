import { describe, expect, it } from "vitest";
import {
  buildReportArchiveSearchIndex,
  filterReportArchive,
  getReportArchivePage,
  getReportArchivePageCount,
} from "@/lib/reportArchiveSearch";

const reports = [
  {
    id: "1",
    studentName: "김 민지",
    fileName: "고려대 모의.pdf",
    sourceName: "김민지",
    essayTopic: "인문 논술",
    classId: "class-a",
    isRead: true,
  },
  {
    id: "2",
    studentName: "박태은",
    fileName: "경희대.pdf",
    sourceName: "박태은",
    essayTopic: "사회 계열",
    classId: "class-b",
    isRead: false,
  },
];

describe("reportArchiveSearch", () => {
  it("keeps the existing multi-field substring search behavior", () => {
    const index = buildReportArchiveSearchIndex(reports);

    expect(
      filterReportArchive(index, { classId: "all", keyword: "고려대", readStatus: "all" }),
    ).toEqual([reports[0]]);
    expect(
      filterReportArchive(index, { classId: "all", keyword: "사회", readStatus: "all" }),
    ).toEqual([reports[1]]);
  });

  it("combines class and read filters", () => {
    const index = buildReportArchiveSearchIndex(reports);

    expect(
      filterReportArchive(index, { classId: "class-b", keyword: "", readStatus: "unread" }),
    ).toEqual([reports[1]]);
  });

  it("limits rendering to the requested page and clamps invalid pages", () => {
    const manyReports = Array.from({ length: 121 }, (_, index) => index);

    expect(getReportArchivePageCount(manyReports.length, 50)).toBe(3);
    expect(getReportArchivePage(manyReports, 2, 50)).toEqual({
      page: 2,
      reports: manyReports.slice(50, 100),
    });
    expect(getReportArchivePage(manyReports, 99, 50)).toEqual({
      page: 3,
      reports: manyReports.slice(100),
    });
  });
});
