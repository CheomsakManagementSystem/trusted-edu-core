import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { studentsApi, Student } from "@/lib/api";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Edit, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

const emptyStudent: Student = {
  name: "", class: "", phone: "", parentPhone: "", school: "", grade: "", enrollDate: "", status: "재원"
};

const Students = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student>(emptyStudent);
  const [isEditing, setIsEditing] = useState(false);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const data = await studentsApi.getAll();
      setStudents(Array.isArray(data) ? data : []);
    } catch {
      toast.error("학생 데이터를 불러오는데 실패했습니다");
      setStudents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStudents(); }, []);

  const handleSave = async () => {
    try {
      if (isEditing && editingStudent.id) {
        await studentsApi.update(editingStudent.id, editingStudent);
        toast.success("학생 정보가 수정되었습니다");
      } else {
        await studentsApi.create(editingStudent);
        toast.success("학생이 등록되었습니다");
      }
      setDialogOpen(false);
      setEditingStudent(emptyStudent);
      fetchStudents();
    } catch {
      toast.error("저장에 실패했습니다");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await studentsApi.delete(id);
      toast.success("삭제되었습니다");
      fetchStudents();
    } catch {
      toast.error("삭제에 실패했습니다");
    }
  };

  const openEdit = (student: Student) => {
    setEditingStudent(student);
    setIsEditing(true);
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingStudent(emptyStudent);
    setIsEditing(false);
    setDialogOpen(true);
  };

  const filtered = students.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.class?.toLowerCase().includes(search.toLowerCase()) ||
    s.school?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">학생 관리</h2>
            <p className="text-sm text-muted-foreground">전체 학생 {students.length}명</p>
          </div>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary-light">
            <UserPlus className="mr-2 h-4 w-4" /> 학생 등록
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="이름, 반, 학교로 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>반</TableHead>
                <TableHead>학교</TableHead>
                <TableHead>학년</TableHead>
                <TableHead>연락처</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">불러오는 중...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">학생 데이터가 없습니다</TableCell></TableRow>
              ) : (
                filtered.map((s, i) => (
                  <TableRow key={s.id || i}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.class}</TableCell>
                    <TableCell>{s.school}</TableCell>
                    <TableCell>{s.grade}</TableCell>
                    <TableCell>{s.phone}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.status === "재원" ? "bg-success/10 text-success" :
                        s.status === "휴원" ? "bg-warning/10 text-warning" :
                        "bg-muted text-muted-foreground"
                      }`}>{s.status || "재원"}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => s.id && handleDelete(s.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{isEditing ? "학생 정보 수정" : "학생 등록"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>이름 *</Label>
                <Input value={editingStudent.name} onChange={e => setEditingStudent({...editingStudent, name: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>반 *</Label>
                <Input value={editingStudent.class} onChange={e => setEditingStudent({...editingStudent, class: e.target.value})} placeholder="예: 고2 심화반" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>학교</Label>
                  <Input value={editingStudent.school || ""} onChange={e => setEditingStudent({...editingStudent, school: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>학년</Label>
                  <Input value={editingStudent.grade || ""} onChange={e => setEditingStudent({...editingStudent, grade: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>학생 연락처</Label>
                  <Input value={editingStudent.phone || ""} onChange={e => setEditingStudent({...editingStudent, phone: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>학부모 연락처</Label>
                  <Input value={editingStudent.parentPhone || ""} onChange={e => setEditingStudent({...editingStudent, parentPhone: e.target.value})} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>상태</Label>
                <Select value={editingStudent.status || "재원"} onValueChange={v => setEditingStudent({...editingStudent, status: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="재원">재원</SelectItem>
                    <SelectItem value="휴원">휴원</SelectItem>
                    <SelectItem value="퇴원">퇴원</SelectItem>
                  </SelectContent>
                </Select>
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

export default Students;
