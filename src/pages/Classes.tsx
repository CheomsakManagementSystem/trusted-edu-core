import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { classesApi, ClassInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

const emptyClass: ClassInfo = { name: "", instructor: "", schedule: "", maxStudents: 15, currentStudents: 0, status: "운영중" };

const Classes = () => {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassInfo>(emptyClass);
  const [isEditing, setIsEditing] = useState(false);

  const fetchClasses = async () => {
    setLoading(true);
    try {
      const data = await classesApi.getAll();
      setClasses(Array.isArray(data) ? data : []);
    } catch {
      toast.error("수업 데이터를 불러오는데 실패했습니다");
      setClasses([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchClasses(); }, []);

  const handleSave = async () => {
    try {
      if (isEditing && editing.id) {
        await classesApi.update(editing.id, editing);
        toast.success("수업 정보가 수정되었습니다");
      } else {
        await classesApi.create(editing);
        toast.success("수업이 등록되었습니다");
      }
      setDialogOpen(false);
      fetchClasses();
    } catch { toast.error("저장에 실패했습니다"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await classesApi.delete(id);
      toast.success("삭제되었습니다");
      fetchClasses();
    } catch { toast.error("삭제에 실패했습니다"); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">수업 관리</h2>
            <p className="text-sm text-muted-foreground">전체 {classes.length}개 반</p>
          </div>
          <Button onClick={() => { setEditing(emptyClass); setIsEditing(false); setDialogOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary-light">
            <Plus className="mr-2 h-4 w-4" /> 수업 추가
          </Button>
        </div>

        {/* Class cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <p className="col-span-full text-center py-8 text-muted-foreground">불러오는 중...</p>
          ) : classes.length === 0 ? (
            <p className="col-span-full text-center py-8 text-muted-foreground">등록된 수업이 없습니다</p>
          ) : (
            classes.map((c, i) => (
              <div key={c.id || i} className="rounded-lg border border-border bg-card p-5 shadow-card">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-card-foreground">{c.name}</h3>
                    <p className="text-sm text-muted-foreground">{c.instructor || "미정"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.status === "운영중" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                  }`}>{c.status || "운영중"}</span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <p>📅 {c.schedule || "미정"}</p>
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{c.currentStudents || 0} / {c.maxStudents || 15}명</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditing(c); setIsEditing(true); setDialogOpen(true); }}>
                    <Edit className="mr-1 h-3 w-3" /> 수정
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => c.id && handleDelete(c.id)}>
                    <Trash2 className="mr-1 h-3 w-3 text-destructive" /> 삭제
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{isEditing ? "수업 수정" : "수업 추가"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>반 이름 *</Label>
                <Input value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} placeholder="예: 고2 심화반" />
              </div>
              <div className="grid gap-2">
                <Label>담당 강사</Label>
                <Input value={editing.instructor || ""} onChange={e => setEditing({...editing, instructor: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>수업 일정</Label>
                <Input value={editing.schedule || ""} onChange={e => setEditing({...editing, schedule: e.target.value})} placeholder="예: 월/수 18:00-20:00" />
              </div>
              <div className="grid gap-2">
                <Label>최대 인원</Label>
                <Input type="number" value={editing.maxStudents || 15} onChange={e => setEditing({...editing, maxStudents: Number(e.target.value)})} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
              <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary-light">저장</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default Classes;
