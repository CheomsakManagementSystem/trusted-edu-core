import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toDrivePreviewUrl } from "@/lib/drive";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

type MaterialDoc = {
  id: string;
  title: string;
  driveUrl: string;
  previewUrl: string | null;
  classId: string;
  className?: string;
};

const StudentDashboard = () => {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<MaterialDoc[]>([]);
  const [selected, setSelected] = useState<MaterialDoc | null>(null);

  useEffect(() => {
    if (!user?.classId) {
      setMaterials([]);
      return;
    }

    const q = query(
      collection(db, "materials"),
      where("classId", "==", user.classId)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: MaterialDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        list.push({
          id: d.id,
          title: data.title,
          driveUrl: data.driveUrl,
          previewUrl: data.previewUrl ?? toDrivePreviewUrl(data.driveUrl),
          classId: data.classId,
          className: data.className,
        });
      });
      setMaterials(list);
    });
    return () => unsub();
  }, [user?.classId]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">학생 대시보드</h2>
          <p className="text-sm text-muted-foreground">
            나의 논술 리포트와 학습 현황을 확인하세요.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-card-foreground">
                배정된 반의 PDF 자료
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                관리자가 배정한 반에 해당하는 자료들이 여기 표시됩니다.
              </p>
            </div>
            {user?.className && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {user.className}
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {materials.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="flex flex-col items-start rounded-lg border border-border bg-background p-4 text-left shadow-sm transition hover:border-primary hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-card-foreground">
                    {m.title}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {m.className || "배정 반"}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  클릭하면 새 창 없이 바로 PDF를 확인할 수 있습니다.
                </p>
              </button>
            ))}
            {materials.length === 0 && (
              <p className="text-sm text-muted-foreground">
                아직 이 반에 배포된 자료가 없습니다. 추후 관리자가 업로드하면 이곳에
                표시됩니다.
              </p>
            )}
          </div>
        </div>

        {/* 추가적인 학생용 콘텐츠는 이후 이 아래에 확장 가능 */}
      </div>

      {/* PDF Viewer Dialog */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-w-4xl border-border bg-background">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span>{selected.title}</span>
                </DialogTitle>
              </DialogHeader>
              {selected.previewUrl ? (
                <div className="mt-3 h-[70vh] overflow-hidden rounded-md border border-border">
                  <iframe
                    src={selected.previewUrl}
                    className="h-full w-full"
                    allow="autoplay"
                    title={selected.title}
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <p>
                    미리보기 URL을 생성할 수 없습니다. 아래 버튼을 눌러 원본 링크를
                    새 창에서 열어주세요.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(selected.driveUrl, "_blank")}
                  >
                    새 창에서 열기
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default StudentDashboard;

