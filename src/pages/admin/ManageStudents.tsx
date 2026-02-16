import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Plus, Edit, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

interface StudentRow {
  id: string;
  student_code: string;
  name: string;
  phone: string | null;
  class_id: string | null;
  auth_user_id: string | null;
  created_at: string;
}

interface ClassOption { id: string; name: string; }

const ManageStudents = () => {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ id: "", student_code: "", name: "", phone: "", class_id: "" });

  const fetchData = async () => {
    setLoading(true);
    const [sRes, cRes] = await Promise.all([
      supabase.from("students").select("*").order("created_at", { ascending: false }),
      supabase.from("classes").select("id, name"),
    ]);
    setStudents((sRes.data as StudentRow[]) || []);
    setClasses((cRes.data as ClassOption[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    const payload = {
      student_code: form.student_code,
      name: form.name,
      phone: form.phone || null,
      class_id: form.class_id || null,
    };
    try {
      if (isEditing) {
        const { error } = await supabase.from("students").update(payload).eq("id", form.id);
        if (error) throw error;
        toast.success("학생 정보가 수정되었습니다");
      } else {
        const { error } = await supabase.from("students").insert(payload);
        if (error) throw error;
        toast.success("학생이 등록되었습니다");
      }
      setDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "저장 실패");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("삭제되었습니다"); fetchData(); }
  };

  const openCreate = () => {
    const nextCode = `STU${String(students.length + 1).padStart(4, "0")}`;
    setForm({ id: "", student_code: nextCode, name: "", phone: "", class_id: "" });
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEdit = (s: StudentRow) => {
    setForm({ id: s.id, student_code: s.student_code, name: s.name, phone: s.phone || "", class_id: s.class_id || "" });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const getClassName = (id: string | null) => classes.find(c => c.id === id)?.name || "-";

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.student_code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">학생 관리</h2>
            <p className="text-sm text-muted-foreground">전체 {students.length}명</p>
          </div>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground">
            <Plus className="mr-2 h-4 w-4" /> 학생 등록
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="이름, 학번으로 검색..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <div className="rounded-lg border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>학번</TableHead>
                <TableHead>이름</TableHead>
                <TableHead>반</TableHead>
                <TableHead>연락처</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">불러오는 중...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">학생이 없습니다</TableCell></TableRow>
              ) : filtered.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-sm">{s.student_code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{getClassName(s.class_id)}</TableCell>
                  <TableCell>{s.phone || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{isEditing ? "학생 수정" : "학생 등록"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>학번 *</Label>
                <Input value={form.student_code} onChange={e => setForm({ ...form, student_code: e.target.value })} placeholder="STU0001" />
              </div>
              <div className="grid gap-2">
                <Label>이름 *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>연락처</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="010-0000-0000" />
              </div>
              <div className="grid gap-2">
                <Label>반 배정</Label>
                <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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

export default ManageStudents;
