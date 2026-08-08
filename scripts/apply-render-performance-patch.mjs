import fs from "node:fs";

const path = "src/pages/Admin/UploadDashboard.tsx";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (before, after, marker) => {
  if (marker && source.includes(marker)) return;
  if (!source.includes(before)) throw new Error(`UploadDashboard target not found: ${before.slice(0, 80)}`);
  source = source.replace(before, after);
};

replaceOnce(
  "  const fileInputRef = useRef<HTMLInputElement | null>(null);\n  const toastRef = useRef(toast);",
  "  const fileInputRef = useRef<HTMLInputElement | null>(null);\n  const archiveSectionRef = useRef<HTMLDivElement | null>(null);\n  const publishedLoadStateRef = useRef<\"idle\" | \"loading\" | \"loaded\">(\"idle\");\n  const toastRef = useRef(toast);",
  "publishedLoadStateRef",
);

replaceOnce(
  "  const [publishedReports, setPublishedReports] = useState<ReportRecord[]>([]);\n  const [pendingReports, setPendingReports] = useState<ReportRecord[]>([]);",
  "  const [publishedReports, setPublishedReports] = useState<ReportRecord[]>([]);\n  const [publishedReportsLoading, setPublishedReportsLoading] = useState(false);\n  const [publishedReportsLoaded, setPublishedReportsLoaded] = useState(false);\n  const [pendingReports, setPendingReports] = useState<ReportRecord[]>([]);",
  "publishedReportsLoading",
);

const oldEffect = `  useEffect(() => {
    const measurement = startPerformanceTrace("admin_published_load");
    const run = async () => {
      try {
        const reports = await fetchPublishedReports();
        setPublishedReports(reports);
        measurement.stop({ status: "success", metrics: { report_count: reports.length } });
      } catch (error) {
        measurement.stop({ status: "error" });
        throw error;
      }
    };
    void run();
  }, []);
`;

const newEffect = `  const loadPublishedReports = useCallback(async (force = false): Promise<ReportRecord[]> => {
    if (!force && publishedLoadStateRef.current !== "idle") {
      return publishedReports;
    }

    publishedLoadStateRef.current = "loading";
    setPublishedReportsLoading(true);
    const measurement = startPerformanceTrace("admin_published_load");
    try {
      const reports = await fetchPublishedReports();
      setPublishedReports(reports);
      setPublishedReportsLoaded(true);
      publishedLoadStateRef.current = "loaded";
      measurement.stop({ status: "success", metrics: { report_count: reports.length } });
      return reports;
    } catch (error) {
      publishedLoadStateRef.current = "idle";
      measurement.stop({ status: "error" });
      toastRef.current({
        variant: "destructive",
        title: "리포트 보관함 조회 실패",
        description: error instanceof Error ? error.message : "배포된 리포트를 불러오지 못했습니다.",
      });
      return [];
    } finally {
      setPublishedReportsLoading(false);
    }
  }, [publishedReports]);

  useEffect(() => {
    if (publishedReportsLoaded) return;
    const target = archiveSectionRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      void loadPublishedReports();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadPublishedReports();
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadPublishedReports, publishedReportsLoaded]);
`;

replaceOnce(oldEffect, newEffect, "const loadPublishedReports = useCallback");

replaceOnce(
  "  const handleRefreshReadStatus = async () => {\n    const [published, reports, pending] = await Promise.all([\n      fetchPublishedReports(),",
  "  const handleRefreshReadStatus = async () => {\n    const [published, reports, pending] = await Promise.all([\n      loadPublishedReports(true),",
  "loadPublishedReports(true)",
);

replaceOnce(
  "        <div className=\"rounded-lg border border-border bg-card p-5 shadow-card\">\n          <div className=\"mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between\">\n            <h3 className=\"text-sm font-semibold text-card-foreground\">배포된 리포트 보관함</h3>",
  "        <div ref={archiveSectionRef} className=\"rounded-lg border border-border bg-card p-5 shadow-card\">\n          <div className=\"mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between\">\n            <h3 className=\"text-sm font-semibold text-card-foreground\">배포된 리포트 보관함</h3>",
  "ref={archiveSectionRef}",
);

replaceOnce(
  "            <p className=\"text-xs text-muted-foreground\">총 {filteredPublishedReports.length}건</p>",
  "            <p className=\"text-xs text-muted-foreground\">\n              {publishedReportsLoading && !publishedReportsLoaded ? \"불러오는 중...\" : `총 ${filteredPublishedReports.length}건`}\n            </p>",
  "publishedReportsLoading && !publishedReportsLoaded",
);

replaceOnce(
  "                  className=\"grid grid-cols-1 gap-2 rounded-lg border border-border bg-background px-3 py-2.5 md:grid-cols-[1.2fr_1fr_0.7fr_0.7fr_auto]\"\n                >",
  "                  className=\"grid grid-cols-1 gap-2 rounded-lg border border-border bg-background px-3 py-2.5 md:grid-cols-[1.2fr_1fr_0.7fr_0.7fr_auto]\"\n                  style={{ contentVisibility: \"auto\", containIntrinsicSize: \"96px\" }}\n                >",
  "containIntrinsicSize: \"96px\"",
);

replaceOnce(
  "            {filteredPublishedReports.length === 0 && (\n              <p className=\"text-sm text-muted-foreground\">검색 결과가 없습니다</p>\n            )}",
  "            {publishedReportsLoading && !publishedReportsLoaded ? (\n              <p className=\"text-sm text-muted-foreground\">리포트 보관함을 불러오는 중입니다...</p>\n            ) : filteredPublishedReports.length === 0 ? (\n              <p className=\"text-sm text-muted-foreground\">검색 결과가 없습니다</p>\n            ) : null}",
  "리포트 보관함을 불러오는 중입니다",
);

replaceOnce(
  "                <div key={report.id} className=\"rounded-lg border border-border bg-background p-3\">",
  "                <div\n                  key={report.id}\n                  className=\"rounded-lg border border-border bg-background p-3\"\n                  style={{ contentVisibility: \"auto\", containIntrinsicSize: \"180px\" }}\n                >",
  "containIntrinsicSize: \"180px\"",
);

fs.writeFileSync(path, source);

const classPath = "src/pages/Admin/ClassManager.tsx";
let classSource = fs.readFileSync(classPath, "utf8");
const replaceClass = (before, after, marker) => {
  if (marker && classSource.includes(marker)) return;
  if (!classSource.includes(before)) throw new Error(`ClassManager target not found: ${before.slice(0, 80)}`);
  classSource = classSource.replace(before, after);
};

replaceClass(
  "                  className=\"flex cursor-pointer items-center justify-between rounded-md border border-border bg-background px-3 py-2\"\n                >",
  "                  className=\"flex cursor-pointer items-center justify-between rounded-md border border-border bg-background px-3 py-2\"\n                  style={{ contentVisibility: \"auto\", containIntrinsicSize: \"64px\" }}\n                >",
  "containIntrinsicSize: \"64px\"",
);

replaceClass(
  "                      className=\"rounded-md border border-border bg-background px-3 py-3 space-y-2\"\n                    >",
  "                      className=\"rounded-md border border-border bg-background px-3 py-3 space-y-2\"\n                      style={{ contentVisibility: \"auto\", containIntrinsicSize: \"112px\" }}\n                    >",
  "containIntrinsicSize: \"112px\"",
);

fs.writeFileSync(classPath, classSource);
console.log("Render performance patch applied.");
