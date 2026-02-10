import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { scoresApi, Score } from "@/lib/api";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

const emptyScore: Score = { studentId: "", studentName: "", subject: "", score: 0, date: new Date().toISOString().slice(0, 10), feedback: "" };

const Scores = () => {
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Score>(emptyScore);
  const [isEditing, setIsEditing] = useState(false);

  const fetchScores = async () => {
    setLoading(true);
    try {
      const data = await scoresApi.getAll();
      setScores(Array.isArray(data) ? data : []);
    } catch {
      toast.error("성적 데이터를 불러오는데 실패했습니다");
      setScores([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchScores(); }, []);

  const handleSave = async () => {
    try {
      if (isEditing && editing.id) {
        await scoresApi.update(editing.id, editing);
        toast.success("성적이 수정되었습니다");
      } else {
        await scoresApi.create(editing);
        toast.success("성적이 등록되었습니다");
      }
      setDialogOpen(false);
      fetchScores();
    } catch { toast.error("저장에 실패했습니다"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await scoresApi.delete(id);
      toast.success("삭제되었습니다");
      fetchScores();
    } catch { toast.error("삭제에 실패했습니다"); }
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-success";
    if (score >= 70) return "text-primary-accent";
    return "text-warning";
  };

  const filtered = scores.filter(s =>
    s.studentName?.toLowerCase().includes(search.toLowerCase()) ||
    s.subject?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">성적 관리</h2>
            <p className="text-sm text-muted-foreground">전체 {scores.length}건</p>
          </div>
          <Button onClick={() => { setEditing(emptyScore); setIsEditing(false); setDialogOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary-light">
            <Plus className="mr-2 h-4 w-4" /> 성적 입력
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="학생 이름, 과목으로 검색..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <div className="rounded-lg border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>학생</TableHead>
                <TableHead>과목</TableHead>
                <TableHead>점수</TableHead>
                <TableHead>날짜</TableHead>
                <TableHead>피드백</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">불러오는 중...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">성적 데이터가 없습니다</TableCell></TableRow>
              ) : (
                filtered.map((s, i) => (
                  <TableRow key={s.id || i}>
                    <TableCell className="font-medium">{s.studentName}</TableCell>
                    <TableCell>{s.subject}</TableCell>
                    <TableCell><span className={`font-semibold ${getScoreColor(s.score)}`}>{s.score}점</span></TableCell>
                    <TableCell>{s.date}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{s.feedback || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(s); setIsEditing(true); setDialogOpen(true); }}>
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

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{isEditing ? "성적 수정" : "성적 입력"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>학생 이름 *</Label>
                <Input value={editing.studentName || ""} onChange={e => setEditing({...editing, studentName: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>과목 *</Label>
                  <Input value={editing.subject} onChange={e => setEditing({...editing, subject: e.target.value})} placeholder="예: 논리력" />
                </div>
                <div className="grid gap-2">
                  <Label>점수 *</Label>
                  <Input type="number" min={0} max={100} value={editing.score} onChange={e => setEditing({...editing, score: Number(e.target.value)})} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>날짜</Label>
                <Input type="date" value={editing.date} onChange={e => setEditing({...editing, date: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>피드백</Label>
                <Textarea value={editing.feedback || ""} onChange={e => setEditing({...editing, feedback: e.target.value})} rows={3} />
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

export default Scores;
