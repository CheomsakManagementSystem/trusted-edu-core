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
import { useStudentStats } from "@/hooks/useStudentStats";
import PerformanceChart from "@/components/student/PerformanceChart";
import MaterialGrid from "@/components/student/MaterialGrid";

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
  const { chartData } = useStudentStats({ studentUid: user?.uid });

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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* 자료 리스트 */}
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
          <MaterialGrid
            items={materials.map((m) => ({
              id: m.id,
              title: m.title,
              className: m.className,
            }))}
            onSelect={(id) => {
              const found = materials.find((m) => m.id === id) ?? null;
              setSelected(found);
            }}
          />
        </div>

        {/* 성적 시각화 */}
        <PerformanceChart data={chartData} />
      </div>
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

