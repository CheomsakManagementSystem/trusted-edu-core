import { useState } from "react";
import { listDriveFiles } from "@/api/driveApi";
import { buildSyncResults } from "@/services/syncEngine";
import { applySyncResults, fetchStudents } from "@/services/firestoreService";
import type { SyncResult } from "@/types";

type SyncPhase = "idle" | "scanning" | "ready" | "saving" | "error";

export const useDriveSync = () => {
  const [folderId, setFolderId] = useState("");
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [results, setResults] = useState<SyncResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  const scan = async () => {
    if (!folderId.trim()) return;
    setPhase("scanning");
    setError(null);
    setCreatedCount(0);

    try {
      const [files, students] = await Promise.all([
        listDriveFiles({ folderId: folderId.trim() }),
        fetchStudents(),
      ]);

      const syncResults = buildSyncResults(files, students);
      setResults(syncResults);
      setPhase("ready");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "동기화 스캔 중 알 수 없는 오류가 발생했습니다."
      );
      setPhase("error");
    }
  };

  const commit = async () => {
    if (!results.length) return;
    setPhase("saving");
    setError(null);

    try {
      const { created } = await applySyncResults(results);
      setCreatedCount(created);
      setPhase("idle");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "DB 저장 중 알 수 없는 오류가 발생했습니다."
      );
      setPhase("error");
    }
  };

  const summary = {
    total: results.length,
    matched: results.filter((r) => r.status === "matched").length,
    noStudent: results.filter((r) => r.status === "no_student").length,
    parseError: results.filter((r) => r.status === "parse_error").length,
  };

  return {
    folderId,
    setFolderId,
    phase,
    results,
    error,
    createdCount,
    scan,
    commit,
    summary,
  };
};

