import { type ChangeEvent, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import {
  classifyPdfFiles,
  uploadValidatedReportsBatch,
  type UploadFailure,
  type ValidatedPdfFile,
} from "@/lib/pdfEngine";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, FileUp, UploadCloud } from "lucide-react";

const AdminDashboard = () => {
  const { user } = useAuth();
  const [validFiles, setValidFiles] = useState<ValidatedPdfFile[]>([]);
  const [invalidFiles, setInvalidFiles] = useState<UploadFailure[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastFailures, setLastFailures] = useState<UploadFailure[]>([]);

  const totalSelected = validFiles.length + invalidFiles.length;

  const summaryText = useMemo(() => {
    if (totalSelected === 0) {
      return "PDF를 선택하면 형식 검증 후 업로드 대상을 자동 분류합니다.";
    }
    return `총 ${totalSelected}개 파일 중 ${validFiles.length}개 업로드 가능, ${invalidFiles.length}개 형식 오류`;
  }, [invalidFiles.length, totalSelected, validFiles.length]);

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    const { validFiles: nextValidFiles, invalidFiles: nextInvalidFiles } =
      classifyPdfFiles(selectedFiles);

    setValidFiles(nextValidFiles);
    setInvalidFiles(
      nextInvalidFiles.map((fileResult) => ({
        file: fileResult.file,
        reason: fileResult.reason,
      })),
    );
    setUploadProgress(0);
    setLastFailures([]);
    setMessage(null);
  };

  const handleUpload = async () => {
    if (!user) {
      setMessage("인증 정보가 없어 업로드를 진행할 수 없습니다.");
      return;
    }

    if (validFiles.length === 0) {
      setMessage("업로드 가능한 PDF가 없습니다.");
      return;
    }

    setIsUploading(true);
    setMessage(null);
    setLastFailures([]);

    try {
      const result = await uploadValidatedReportsBatch(
        validFiles,
        user.uid,
        (progress) => setUploadProgress(progress),
      );

      if (result.failureCount > 0) {
        setMessage(
          `${result.successCount}개 업로드 완료, ${result.failureCount}개 실패`,
        );
        setLastFailures(result.failures);
      } else {
        setMessage(`${result.successCount}개 파일 업로드와 DB 동기화가 완료되었습니다.`);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `업로드가 중단되었습니다: ${error.message}`
          : "업로드 중 알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">PDF 리포트 업로드</h2>
          <p className="text-sm text-muted-foreground">{summaryText}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={FileUp} title="선택 파일" value={totalSelected} />
          <StatCard
            icon={CheckCircle2}
            title="업로드 가능"
            value={validFiles.length}
            changeType="positive"
          />
          <StatCard
            icon={AlertTriangle}
            title="형식 오류"
            value={invalidFiles.length}
            changeType={invalidFiles.length > 0 ? "negative" : "neutral"}
          />
          <StatCard
            icon={UploadCloud}
            title="진행률"
            value={`${Math.round(uploadProgress)}%`}
            change={isUploading ? "업로드 중" : "대기 중"}
            changeType={isUploading ? "positive" : "neutral"}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              type="file"
              multiple
              accept=".pdf,application/pdf"
              onChange={handleFileSelection}
              className="max-w-xl"
            />
            <Button
              onClick={handleUpload}
              disabled={isUploading || validFiles.length === 0}
            >
              {isUploading ? "업로드 진행 중..." : "업로드 시작"}
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            <Progress value={uploadProgress} className="h-2 bg-muted" />
            <p className="text-xs text-muted-foreground">
              Storage 업로드와 Firestore 동기화 진행률
            </p>
          </div>

          {message && (
            <p className="mt-3 text-sm text-card-foreground">{message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h3 className="mb-3 text-sm font-semibold text-card-foreground">
              업로드 가능 파일
            </h3>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {validFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">유효한 파일이 없습니다.</p>
              ) : (
                validFiles.map(({ file, parsed }) => (
                  <div
                    key={file.name}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-card-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {parsed.studentName} / 학번 {parsed.studentId} / {parsed.score}점
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h3 className="mb-3 text-sm font-semibold text-card-foreground">
              형식 오류 및 업로드 실패
            </h3>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {invalidFiles.length === 0 && lastFailures.length === 0 ? (
                <p className="text-sm text-muted-foreground">오류 파일이 없습니다.</p>
              ) : (
                [...invalidFiles, ...lastFailures].map((item, index) => (
                  <div
                    key={`${item.file.name}-${index}`}
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-card-foreground">{item.file.name}</p>
                    <p className="text-xs text-destructive">{item.reason}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
