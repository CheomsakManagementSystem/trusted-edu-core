import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { toast } from "sonner";

interface ClassRow {
  id: string;
  name: string;
  schedule: string | null;
  location: string | null;
  teacher_id: string | null;
  created_at: string;
}

interface TeacherOption {
  id: string;
  name: string | null;
}

const ManageClasses = () => {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", schedule: "", location: "", teacher_id: "" });

  const fetchData = async () => {
    setLoading(true);
    const [classRes, teacherRes] = await Promise.all([
      supabase.from("classes").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id").eq("role", "teacher"),
    ]);
    setClasses((classRes.data as ClassRow[]) || []);

    if (teacherRes.data && teacherRes.data.length > 0) {
      const ids = teacherRes.data.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, name").in("id", ids);
      setTeachers((profiles as TeacherOption[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    const payload = {
      name: form.name,
      schedule: form.schedule || null,
      location: form.location || null,
      teacher_id: form.teacher_id || null,
    };
    try {
      if (isEditing) {
        const { error } = await supabase.from("classes").update(payload).eq("id", form.id);
        if (error) throw error;
        toast.success("수업이 수정되었습니다");
      } else {
        const { error } = await supabase.from("classes").insert(payload);
        if (error) throw error;
        toast.success("수업이 등록되었습니다");
      }
      setDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "저장 실패");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("삭제되었습니다"); fetchData(); }
  };

  const openCreate = () => {
    setForm({ id: "", name: "", schedule: "", location: "", teacher_id: "" });
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEdit = (c: ClassRow) => {
    setForm({ id: c.id, name: c.name, schedule: c.schedule || "", location: c.location || "", teacher_id: c.teacher_id || "" });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const getTeacherName = (id: string | null) => teachers.find(t => t.id === id)?.name || "-";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">수업 관리</h2>
            <p className="text-sm text-muted-foreground">전체 {classes.length}개 반</p>
          </div>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground">
            <Plus className="mr-2 h-4 w-4" /> 수업 추가
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>반 이름</TableHead>
                <TableHead>일정</TableHead>
                <TableHead>장소</TableHead>
                <TableHead>담당 강사</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">불러오는 중...</TableCell></TableRow>
              ) : classes.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">등록된 수업이 없습니다</TableCell></TableRow>
              ) : classes.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.schedule || "-"}</TableCell>
                  <TableCell>{c.location || "-"}</TableCell>
                  <TableCell>{getTeacherName(c.teacher_id)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{isEditing ? "수업 수정" : "수업 추가"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>반 이름 *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: 고2 심화반" />
              </div>
              <div className="grid gap-2">
                <Label>수업 일정</Label>
                <Input value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} placeholder="예: 월/수 18:00-20:00" />
              </div>
              <div className="grid gap-2">
                <Label>장소</Label>
                <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="예: 대치동 본원 301호" />
              </div>
              {teachers.length > 0 && (
                <div className="grid gap-2">
                  <Label>담당 강사</Label>
                  <Select value={form.teacher_id} onValueChange={v => setForm({ ...form, teacher_id: v })}>
                    <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      {teachers.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name || t.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
              <Button onClick={handleSave} className="bg-primary text-primary-foreground">저장</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default ManageClasses;
