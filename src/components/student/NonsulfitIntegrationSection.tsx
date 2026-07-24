import { useMemo, useRef, useState } from "react";
import { BarChart3, Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatExamDate } from "@/lib/pdfProcessor";
import type { ReportRecord } from "@/lib/pdfProcessor";

const NONSULFIT_URL = "https://www.nonsulfit.com/";

const CATEGORY_FIELDS = [
  { key: "reading", label: "독해력" },
  { key: "comprehension", label: "내용 이해력" },
  { key: "problemUnderstanding", label: "문제 이해력" },
  { key: "organization", label: "구성력" },
  { key: "expression", label: "표현력" },
] as const;

type CategoryKey = (typeof CATEGORY_FIELDS)[number]["key"];

const calculateTrimmedMean = (values: number[], trimRatio = 0.1): number => {
  if (values.length === 0) {
    return 0;
  }
  if (values.length <= 3) {
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  }

  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimRatio);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return Number((trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length).toFixed(2));
};

const escapeCsvCell = (value: string | number): string => {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
};

const CSV_BOM = "\uFEFF";

const buildCsvContent = (rows: (string | number)[][]): string => {
  const body = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  return `${CSV_BOM}${body}`;
};

const downloadCsv = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const sanitizeForFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|]/g, "").trim() || "학생";

const getTodayStamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
};

interface Props {
  studentName: string;
  reports: ReportRecord[];
}

const NonsulfitIntegrationSection = ({ studentName, reports }: Props) => {
  const { toast } = useToast();
  const [exportingType, setExportingType] = useState<"individual" | "summary" | null>(null);
  const exportLockRef = useRef(false);

  const chronologicalReports = useMemo(
    () => [...reports].sort((a, b) => a.examDate.localeCompare(b.examDate) || 0),
    [reports],
  );

  const totalScores = useMemo(
    () => reports.map((report) => report.totalScore).filter((score): score is number => typeof score === "number"),
    [reports],
  );

  const normalMean = useMemo(
    () =>
      totalScores.length
        ? Number((totalScores.reduce((sum, score) => sum + score, 0) / totalScores.length).toFixed(2))
        : 0,
    [totalScores],
  );

  const trimmedMean = useMemo(() => calculateTrimmedMean(totalScores), [totalScores]);

  const highestScore = totalScores.length ? Math.max(...totalScores) : 0;
  const lowestScore = totalScores.length ? Math.min(...totalScores) : 0;

  const categoryTrimmedMeans = useMemo(() => {
    const result: Record<CategoryKey, number> = {
      reading: 0,
      comprehension: 0,
      problemUnderstanding: 0,
      organization: 0,
      expression: 0,
    };
    for (const { key } of CATEGORY_FIELDS) {
      const values = reports
        .map((report) => report.scores?.[key])
        .filter((value): value is number => typeof value === "number");
      result[key] = calculateTrimmedMean(values);
    }
    return result;
  }, [reports]);

  const hasReports = reports.length > 0;

  const runExport = async (type: "individual" | "summary", build: () => { fileName: string; content: string }) => {
    if (exportLockRef.current || !hasReports) {
      return;
    }

    exportLockRef.current = true;
    setExportingType(type);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      const { fileName, content } = build();
      downloadCsv(fileName, content);
    } catch (exportError) {
      toast({
        variant: "destructive",
        title: "CSV 내보내기 실패",
        description: exportError instanceof Error ? exportError.message : "파일을 생성하지 못했습니다.",
      });
    } finally {
      window.setTimeout(() => {
        exportLockRef.current = false;
        setExportingType(null);
      }, 300);
    }
  };

  const handleExportIndividualCSV = () =>
    runExport("individual", () => {
      const header = [
        "회차",
        "시험일자",
        "강좌명",
        "독해력",
        "내용 이해력",
        "문제 이해력",
        "구성력",
        "표현력",
        "총점",
        "첨삭 총평",
        "첨삭 PDF 링크",
      ];

      const rows = chronologicalReports.map((report, index) => [
        index + 1,
        formatExamDate(report.examDate),
        report.className || "기록 없음",
        report.scores?.reading ?? "-",
        report.scores?.comprehension ?? "-",
        report.scores?.problemUnderstanding ?? "-",
        report.scores?.organization ?? "-",
        report.scores?.expression ?? "-",
        report.totalScore ?? "-",
        report.feedback || "",
        report.fileUrl || "",
      ]);

      return {
        fileName: `논술핏_상세리포트_${sanitizeForFileName(studentName)}_${getTodayStamp()}.csv`,
        content: buildCsvContent([header, ...rows]),
      };
    });

  const handleExportSummaryCSV = () =>
    runExport("summary", () => {
      const combinedFeedback = chronologicalReports
        .map((report, index) => `[${index + 1}회차 / ${formatExamDate(report.examDate)}]\n${report.feedback || "첨삭 총평 없음"}`)
        .join("\n\n--------------------\n\n");

      const rows: (string | number)[][] = [
        ["학생명", studentName],
        ["총 응시 횟수", reports.length],
        ["일반 평균 점수", normalMean],
        ["절사 평균 점수 (상·하위 10% 절사)", trimmedMean],
        ["최고 점수", highestScore],
        ["최저 점수", lowestScore],
        ...CATEGORY_FIELDS.map(({ key, label }) => [`영역별 절사평균 - ${label}`, categoryTrimmedMeans[key]]),
        [""],
        ["전체 첨삭 총평 모음", combinedFeedback],
      ];

      return {
        fileName: `논술핏_종합통계_절사평균_${sanitizeForFileName(studentName)}_${getTodayStamp()}.csv`,
        content: buildCsvContent(rows),
      };
    });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900 md:text-base">
              논술핏 성적 연동 &amp; 종합 리포트
            </h3>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
              NEW
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            수치 데이터와 첨삭 총평을 바탕으로 정밀 진단된 종합 성장 추이를 확인하고 내보냅니다.
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-500">총 응시 횟수</p>
          <p className="mt-1 text-xl font-black text-slate-900">{reports.length}회</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-500">일반 평균</p>
          <p className="mt-1 text-xl font-black text-slate-900">{hasReports ? normalMean : "-"}점</p>
        </div>
        <div className="rounded-lg border border-primary-accent/40 bg-blue-50 px-3 py-2">
          <p className="text-xs font-semibold text-blue-700">절사 평균 (상·하위 10% 절사)</p>
          <p className="mt-1 text-xl font-black text-primary-accent">{hasReports ? trimmedMean : "-"}점</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-500">최고 / 최저</p>
          <p className="mt-1 text-xl font-black text-slate-900">
            {hasReports ? `${highestScore} / ${lowestScore}` : "-"}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            disabled={!hasReports || exportingType !== null}
            onClick={handleExportIndividualCSV}
            className="justify-center"
          >
            {exportingType === "individual" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            개별 리포트 CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hasReports || exportingType !== null}
            onClick={handleExportSummaryCSV}
            className="justify-center border-primary-accent/50 text-primary-accent hover:bg-blue-50 hover:text-primary-accent"
          >
            {exportingType === "summary" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BarChart3 className="h-4 w-4" />
            )}
            종합 통계·절사평균 CSV
          </Button>
        </div>

        <a
          href={NONSULFIT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center gap-1.5 rounded-md bg-primary-accent px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-accent/90 md:h-10"
        >
          논술핏으로 이동
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {!hasReports && (
        <p className="mt-3 text-xs text-slate-500">아직 리포트 데이터가 없어 내보내기를 사용할 수 없습니다.</p>
      )}
    </section>
  );
};

export default NonsulfitIntegrationSection;
