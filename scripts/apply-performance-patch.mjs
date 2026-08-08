import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, content) => fs.writeFileSync(path, content);

const replaceOnce = (path, before, after, alreadyMarker) => {
  const source = read(path);
  if (alreadyMarker && source.includes(alreadyMarker)) return;
  if (!source.includes(before)) {
    throw new Error(`${path}: replacement target not found`);
  }
  write(path, source.replace(before, after));
};

const replaceSection = (path, startMarker, endMarker, replacement, alreadyMarker) => {
  const source = read(path);
  if (alreadyMarker && source.includes(alreadyMarker)) return;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`${path}: section markers not found: ${startMarker}`);
  }
  write(path, `${source.slice(0, start)}${replacement.trim()}\n\n${source.slice(end)}`);
};

const replaceTail = (path, startMarker, replacement, alreadyMarker) => {
  const source = read(path);
  if (alreadyMarker && source.includes(alreadyMarker)) return;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${path}: tail marker not found: ${startMarker}`);
  write(path, `${source.slice(0, start)}${replacement.trim()}\n`);
};

const pdfPath = "src/lib/pdfProcessor.ts";
replaceOnce(
  pdfPath,
  "  doc,\n  getDoc,",
  "  doc,\n  documentId,\n  getDoc,",
  "  documentId,\n  getDoc,",
);

replaceSection(
  pdfPath,
  "export const publishReportBatch = async (",
  "export const fetchStudents = async",
  `
const MAX_CONCURRENT_REPORT_UPLOADS = 3;

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index], index);
      }
    }),
  );
};

export const publishReportBatch = async (
  uploadRows: UploadCandidate[],
  selectedClass: ClassLite,
  examDate: string,
  allStudents: StudentLite[],
  uid: string,
  onOverallProgress?: (progress: number) => void,
): Promise<{
  successCount: number;
  failureCount: number;
  pendingCount: number;
  autoAssignedNotices: string[];
  failures: string[];
  results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }>;
}> => {
  if (!uploadRows.length) {
    return {
      successCount: 0,
      failureCount: 0,
      pendingCount: 0,
      autoAssignedNotices: [],
      failures: [],
      results: [],
    };
  }

  const results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }> =
    new Array(uploadRows.length);
  const outcomes: Array<"completed" | "pending" | "failure"> = new Array(uploadRows.length);
  const notices: Array<string | undefined> = new Array(uploadRows.length);
  const failureMessages: Array<string | undefined> = new Array(uploadRows.length);
  const progressByIndex = new Array<number>(uploadRows.length).fill(0);

  const updateProgress = (index: number, progress: number) => {
    progressByIndex[index] = Math.max(progressByIndex[index], Math.min(100, progress));
    const overall = progressByIndex.reduce((sum, value) => sum + value, 0) / uploadRows.length;
    onOverallProgress?.(overall);
  };

  await runWithConcurrency(
    uploadRows,
    MAX_CONCURRENT_REPORT_UPLOADS,
    async (row, index) => {
      try {
        const validationError = getUploadCandidateValidationError(row.parsed);
        if (validationError) {
          throw new Error(validationError);
        }

        const resolvedStudent = row.selectedStudentUid
          ? allStudents.find((entry) => entry.uid === row.selectedStudentUid) ?? null
          : null;
        const assignmentStatus: ReportAssignmentStatus = resolvedStudent
          ? "completed"
          : "unassigned_pending";
        const storageOwnerUid = resolvedStudent?.uid ?? uid;

        const url = await uploadPdfToStorage(storageOwnerUid, row.file, (fileProgress) => {
          updateProgress(index, fileProgress);
        });
        const totalScore = resolveParsedTotalScore(row.parsed);

        const created = await addDoc(collection(db, "reports"), {
          uid,
          classId: selectedClass.id,
          className: selectedClass.name,
          examDate,
          fileHash: row.fileHash ?? null,
          studentUid: resolvedStudent?.uid ?? null,
          studentId: (resolvedStudent?.studentId ?? "").trim() || null,
          studentName: (resolvedStudent?.name ?? row.parsed.name ?? "").trim(),
          assignmentStatus,
          status: resolvedStudent ? "completed" : "pending",
          assignedAt: resolvedStudent ? serverTimestamp() : null,
          sourceName: row.parsed.name || "",
          sourceStudentId: row.parsed.studentId || null,
          sourcePhoneSuffix: row.parsed.phoneSuffix || null,
          sourceClassName: row.parsed.className || null,
          matchReason: row.matchReason ?? null,
          writtenAt: row.parsed.writtenAt || "",
          reviewer: row.parsed.reviewer || "",
          essayTopic: row.parsed.essayTopic || "",
          grade: row.parsed.grade || "",
          feedback: row.parsed.feedback || "",
          scores: {
            ...row.parsed.scores,
            total: totalScore,
          },
          averageScores: row.parsed.averageScores,
          convertedScores: row.parsed.convertedScores,
          parsedJson: {
            ...row.parsed,
            scores: {
              ...row.parsed.scores,
              total: totalScore,
            },
          },
          totalScore,
          isRead: false,
          fileUrl: url,
          fileName: row.file.name,
          sourcePage: row.sourcePage,
          pageNumber: row.sourcePage,
          createdAt: serverTimestamp(),
        });

        outcomes[index] = assignmentStatus === "completed" ? "completed" : "pending";
        results[index] = { candidateId: row.id, success: true, reportId: created.id };

        if (assignmentStatus === "completed" && row.status === "ready" && row.matchReason) {
          notices[index] = `[${resolvedStudent?.name}] 학생에게 리포트를 전달했습니다`;
        }
      } catch (error) {
        const reason = normalizePublishError(error);
        outcomes[index] = "failure";
        failureMessages[index] = `${row.file.name}: ${reason}`;
        results[index] = { candidateId: row.id, success: false, error: reason };
      } finally {
        updateProgress(index, 100);
      }
    },
  );

  const successCount = outcomes.filter((status) => status === "completed").length;
  const pendingCount = outcomes.filter((status) => status === "pending").length;
  const failures = failureMessages.filter((message): message is string => Boolean(message));
  const autoAssignedNotices = notices.filter((message): message is string => Boolean(message));

  return {
    successCount,
    failureCount: failures.length,
    pendingCount,
    autoAssignedNotices,
    failures,
    results,
  };
};
`,
  "MAX_CONCURRENT_REPORT_UPLOADS",
);

replaceSection(
  pdfPath,
  "export const fetchMyClassJoinRequests = async (",
  "export const fetchPendingClassJoinRequests = async",
  `
export const fetchMyClassJoinRequests = async (
  studentUid: string,
): Promise<ClassJoinRequestRecord[]> => {
  const snapshot = await getDocs(
    query(collection(db, "classJoinRequests"), where("studentUid", "==", studentUid)),
  );

  return snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data() as Omit<ClassJoinRequestRecord, "id">;
      return { id: docSnap.id, ...data };
    })
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
};
`,
  "const snapshot = await getDocs(\n    query(collection(db, \"classJoinRequests\"), where(\"studentUid\", \"==\", studentUid)),\n  );\n\n  return snapshot.docs",
);

replaceSection(
  pdfPath,
  "export const fetchPendingClassJoinRequests = async",
  "const resolveStudentDocumentId = async",
  `
export const fetchPendingClassJoinRequests = async (): Promise<ClassJoinRequestRecord[]> => {
  const snapshot = await getDocs(
    query(collection(db, "classJoinRequests"), where("status", "==", "pending")),
  );

  return snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data() as Omit<ClassJoinRequestRecord, "id">;
      return { id: docSnap.id, ...data };
    })
    .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
};
`,
  ".sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));",
);

replaceSection(
  pdfPath,
  "export const fetchReportsByStudentUid = async",
  "export const fetchPendingReports = async",
  `
export const fetchReportsByStudentUid = async (studentUid: string): Promise<ReportRecord[]> => {
  const snapshot = await getDocs(
    query(collection(db, "reports"), where("studentUid", "==", studentUid)),
  );

  return snapshot.docs
    .map((docSnap) => hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">))
    .filter((row) => row.assignmentStatus !== "duplicate_pending" && row.assignmentStatus !== "unassigned_pending")
    .sort(compareReportsByExamDateDesc);
};
`,
  "query(collection(db, \"reports\"), where(\"studentUid\", \"==\", studentUid)),",
);

replaceSection(
  pdfPath,
  "export const fetchPendingReports = async",
  "export const subscribePendingReports = (",
  `
export const fetchPendingReports = async (): Promise<ReportRecord[]> => {
  const statuses: ReportAssignmentStatus[] = ["duplicate_pending", "unassigned_pending"];
  const snapshot = await getDocs(
    query(collection(db, "reports"), where("assignmentStatus", "in", statuses)),
  );

  return snapshot.docs
    .map((docSnap) => hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">))
    .sort(compareReportsByExamDateDesc);
};
`,
  "const statuses: ReportAssignmentStatus[] = [\"duplicate_pending\", \"unassigned_pending\"];\n  const snapshot = await getDocs",
);

replaceSection(
  pdfPath,
  "export const subscribeOpenReportClaims = (",
  "export const fetchReportsByClassId = async",
  `
const fetchReportRecordsByIds = async (reportIds: string[]): Promise<Map<string, ReportRecord>> => {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const chunks: string[][] = [];
  for (let start = 0; start < uniqueIds.length; start += 30) {
    chunks.push(uniqueIds.slice(start, start + 30));
  }

  const snapshots = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, "reports"), where(documentId(), "in", ids))),
    ),
  );

  const reports = new Map<string, ReportRecord>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      reports.set(
        docSnap.id,
        hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">),
      );
    });
  });
  return reports;
};

export const subscribeOpenReportClaims = (
  onChange: (claims: ReportClaimTriageRecord[]) => void,
  onError?: (error: Error) => void,
) => {
  const claimsQuery = query(collection(db, "report_claims"), where("status", "==", "open"));
  let snapshotVersion = 0;

  return onSnapshot(
    claimsQuery,
    async (snapshot) => {
      const version = ++snapshotVersion;
      try {
        const rows = snapshot.docs.map((claimDoc) => {
          const data = claimDoc.data() as {
            reportId?: string;
            studentUid?: string;
            status?: "open" | "resolved";
            createdAt?: Timestamp | null;
            updatedAt?: Timestamp | null;
            resolvedAt?: Timestamp | null;
            resolvedBy?: string | null;
          };
          return {
            id: claimDoc.id,
            reportId: data.reportId ?? "",
            studentUid: data.studentUid ?? "",
            status: data.status ?? "open" as const,
            createdAt: data.createdAt ?? null,
            updatedAt: data.updatedAt ?? null,
            resolvedAt: data.resolvedAt ?? null,
            resolvedBy: data.resolvedBy ?? null,
          };
        });
        const reportsById = await fetchReportRecordsByIds(rows.map((row) => row.reportId));
        if (version !== snapshotVersion) return;

        onChange(
          rows
            .map((row) => ({ ...row, report: reportsById.get(row.reportId) ?? null }))
            .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
        );
      } catch (error) {
        if (version !== snapshotVersion) return;
        onError?.(error instanceof Error ? error : new Error("오배송 신고 리포트를 불러오지 못했습니다."));
      }
    },
    (error) => {
      snapshotVersion += 1;
      onError?.(error);
    },
  );
};
`,
  "fetchReportRecordsByIds",
);

replaceSection(
  pdfPath,
  "export const fetchReportsByClassId = async",
  "export const fetchPublishedReports = async",
  `
export const fetchReportsByClassId = async (classId: string): Promise<ReportRecord[]> => {
  const snapshot = await getDocs(
    query(collection(db, "reports"), where("classId", "==", classId)),
  );
  return snapshot.docs
    .map((docSnap) => hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">))
    .sort(compareReportsByExamDateDesc);
};
`,
  "query(collection(db, \"reports\"), where(\"classId\", \"==\", classId)),",
);

replaceSection(
  pdfPath,
  "export const fetchPublishedReports = async",
  "export const updatePublishedReport = async",
  `
export const fetchPublishedReports = async (): Promise<ReportRecord[]> => {
  const snapshot = await getDocs(
    query(collection(db, "reports"), where("assignmentStatus", "==", "completed")),
  );
  return snapshot.docs
    .map((docSnap) => hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">))
    .sort(compareReportsByExamDateDesc);
};
`,
  "query(collection(db, \"reports\"), where(\"assignmentStatus\", \"==\", \"completed\")),",
);

const adminPath = "src/pages/Admin/UploadDashboard.tsx";
replaceOnce(
  adminPath,
  "import { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from \"react\";",
  "import { DragEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from \"react\";",
  "useDeferredValue",
);
replaceOnce(
  adminPath,
  "  const getClaimStudentLabel = (claim: ReportClaimTriageRecord) => {\n    const student = students.find((item) => item.uid === claim.studentUid);\n    return student ? formatStudentLabel(student) : claim.report?.studentName || \"기록 없음\";\n  };",
  "  const studentByUid = useMemo(() => new Map(students.map((student) => [student.uid, student])), [students]);\n\n  const getClaimStudentLabel = (claim: ReportClaimTriageRecord) => {\n    const student = studentByUid.get(claim.studentUid);\n    return student ? formatStudentLabel(student) : claim.report?.studentName || \"기록 없음\";\n  };",
  "const studentByUid = useMemo",
);
replaceSection(
  adminPath,
  "  const filteredPublishedReports = useMemo(() => {",
  "  const recentClassReports = useMemo(",
  `
  const deferredArchiveStudentFilter = useDeferredValue(archiveStudentFilter);
  const searchablePublishedReports = useMemo(
    () =>
      [...publishedReports]
        .sort(compareReportsByExamDateDesc)
        .map((report) => ({
          report,
          searchText: `${report.studentName} ${report.fileName} ${report.sourceName} ${report.essayTopic}`.toLowerCase(),
        })),
    [publishedReports],
  );
  const filteredPublishedReports = useMemo(() => {
    const keyword = deferredArchiveStudentFilter.trim().toLowerCase();
    return searchablePublishedReports
      .filter(({ report, searchText }) => {
        if (archiveClassFilter !== "all" && report.classId !== archiveClassFilter) return false;
        if (keyword && !searchText.includes(keyword)) return false;
        if (archiveReadFilter === "read" && !report.isRead) return false;
        if (archiveReadFilter === "unread" && report.isRead) return false;
        return true;
      })
      .map(({ report }) => report);
  }, [archiveClassFilter, archiveReadFilter, deferredArchiveStudentFilter, searchablePublishedReports]);
`,
  "const deferredArchiveStudentFilter = useDeferredValue",
);
replaceOnce(
  adminPath,
  `      const result = await publishReportBatch(
        rows,
        selectedClass,
        selectedDateText,
        students,
        user.uid,
        setProgress,
      );
      const controls = await getMasterControls();`,
  `      const [result, controls] = await Promise.all([
        publishReportBatch(
          rows,
          selectedClass,
          selectedDateText,
          students,
          user.uid,
          setProgress,
        ),
        getMasterControls(),
      ]);`,
  "const [result, controls] = await Promise.all",
);
replaceOnce(
  adminPath,
  `      const reports = await fetchReportsByClassId(selectedClass.id);
      setClassReports(reports);
      const pending = await fetchPendingReports();
      setPendingReports(pending);`,
  `      const [reports, pending] = await Promise.all([
        fetchReportsByClassId(selectedClass.id),
        fetchPendingReports(),
      ]);
      setClassReports(reports);
      setPendingReports(pending);`,
  "const [reports, pending] = await Promise.all",
);
replaceSection(
  adminPath,
  "  const handleRefreshReadStatus = async () => {",
  "  const getPendingCandidates = (report: ReportRecord) => {",
  `
  const handleRefreshReadStatus = async () => {
    const [published, reports, pending] = await Promise.all([
      fetchPublishedReports(),
      selectedClass ? fetchReportsByClassId(selectedClass.id) : Promise.resolve(classReports),
      fetchPendingReports(),
    ]);
    setPublishedReports(published);
    setClassReports(reports);
    setPendingReports(pending);
  };
`,
  "const [published, reports, pending] = await Promise.all",
);

const classManagerPath = "src/pages/Admin/ClassManager.tsx";
replaceOnce(
  classManagerPath,
  "import { FormEvent, useEffect, useMemo, useState } from \"react\";",
  "import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from \"react\";",
  "useDeferredValue",
);
replaceOnce(
  classManagerPath,
  `  useEffect(() => {
    console.log("데이터 동기화 분석: 현재 로드된 학생 목록", students.map(s => ({ docId: s.docId, uid: s.uid, classIds: s.classIds, status: s.classIds?.length > 0 ? 'assigned' : 'unassigned' })));
  }, [students]);

`,
  "",
  "__removed_class_manager_debug_log__",
);
replaceOnce(
  classManagerPath,
  `  const filteredStudents = useMemo(() => {
    const searchQuery = search.toLowerCase();`,
  `  const deferredSearch = useDeferredValue(search);
  const filteredStudents = useMemo(() => {
    const searchQuery = deferredSearch.toLowerCase();`,
  "const deferredSearch = useDeferredValue(search)",
);
replaceOnce(
  classManagerPath,
  "  }, [assignableStudents, search]);",
  "  }, [assignableStudents, deferredSearch]);",
  "[assignableStudents, deferredSearch]",
);
replaceOnce(
  classManagerPath,
  `  const filteredManageableStudents = useMemo(() => {
    const keyword = adminSearch.trim().toLowerCase();`,
  `  const deferredAdminSearch = useDeferredValue(adminSearch);
  const filteredManageableStudents = useMemo(() => {
    const keyword = deferredAdminSearch.trim().toLowerCase();`,
  "const deferredAdminSearch = useDeferredValue(adminSearch)",
);
replaceOnce(
  classManagerPath,
  "  }, [adminSearch, students]);",
  "  }, [deferredAdminSearch, students]);",
  "[deferredAdminSearch, students]",
);

const masterPath = "src/services/masterAdminService.ts";
replaceTail(
  masterPath,
  "export const enqueueReportNotifications = async (",
  `
export const enqueueReportNotifications = async (
  reportIds: string[],
  actorUid: string,
): Promise<number> => {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (!uniqueIds.length) return 0;

  const reportSnapshots = await Promise.all(
    chunkBy(uniqueIds, 30).map((ids) =>
      getDocs(query(collection(db, "reports"), where(documentId(), "in", ids))),
    ),
  );
  const reportDocs = reportSnapshots.flatMap((snapshot) => snapshot.docs).filter((reportDoc) => {
    const data = reportDoc.data() as { studentUid?: string | null };
    return Boolean(data.studentUid);
  });

  for (const docs of chunkBy(reportDocs, 400)) {
    const batch = writeBatch(db);
    docs.forEach((reportDoc) => {
      const data = reportDoc.data() as {
        studentUid?: string | null;
        studentName?: string;
        essayTopic?: string;
      };
      const notificationRef = doc(collection(db, "notifications"));
      batch.set(notificationRef, {
        studentUid: data.studentUid,
        reportId: reportDoc.id,
        category: "REPORT_COMPLETED",
        title: "첨삭이 도착했습니다",
        message: `${data.studentName || "학생"}님의 '${data.essayTopic || "리포트"}' 첨삭이 완료되었습니다.`,
        isRead: false,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      });
    });
    await batch.commit();
  }

  return reportDocs.length;
};
`,
  "chunkBy(uniqueIds, 30)",
);

console.log("Performance patch applied.");
