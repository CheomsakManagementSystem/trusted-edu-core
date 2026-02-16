import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface ClassOption { id: string; name: string; }
interface StudentOption { id: string; name: string; student_code: string; class_id: string | null; }

const TeacherScoreEntry = () => {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [saving, setSaving] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [form, setForm] = useState({
    assignment_name: "",
    round: 1,
    written_date: new Date().toISOString().slice(0, 10),
    reading: 0,
    content_understanding: 0,
    problem_understanding: 0,
    composition: 0,
    format: 0,
    feedback: "",
  });

  const totalScore = useMemo(() =>
    form.reading + form.content_understanding + form.problem_understanding + form.composition + form.format,
    [form.reading, form.content_understanding, form.problem_understanding, form.composition, form.format]
  );

  const grade = useMemo(() => {
    if (totalScore >= 90) return "A";
    if (totalScore >= 80) return "B";
    if (totalScore >= 70) return "C";
    if (totalScore >= 60) return "D";
    return "F";
  }, [totalScore]);

  useEffect(() => {
    const fetchData = async () => {
      const [cRes, sRes] = await Promise.all([
        supabase.from("classes").select("id, name"),
        supabase.from("students").select("id, name, student_code, class_id"),
      ]);
      setClasses((cRes.data as ClassOption[]) || []);
      setStudents((sRes.data as StudentOption[]) || []);
    };
    fetchData();
  }, []);

  const filteredStudents = useMemo(() =>
    selectedClass ? students.filter(s => s.class_id === selectedClass) : students,
    [students, selectedClass]
  );

  const handleSubmit = async () => {
    if (!selectedStudent || !form.assignment_name) {
      toast.error("학생과 과제명을 입력해 주세요");
      return;
    }
    setSaving(true);
    try {
      let pdfPath: string | null = null;

      // Upload PDF if provided
      if (pdfFile) {
        const ext = pdfFile.name.split(".").pop();
        const scoreId = crypto.randomUUID();
        const path = `${selectedStudent}/${scoreId}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("attachments").upload(path, pdfFile);
        if (uploadErr) throw uploadErr;
        pdfPath = path;
      }

      const { error } = await supabase.from("scores").insert({
        student_id: selectedStudent,
        class_id: selectedClass || null,
        assignment_name: form.assignment_name,
        round: form.round,
        written_date: form.written_date,
        reading: form.reading,
        content_understanding: form.content_understanding,
        problem_understanding: form.problem_understanding,
        composition: form.composition,
        format: form.format,
        total_score: totalScore,
        grade,
        feedback: form.feedback || null,
        pdf_path: pdfPath,
        created_by: user?.id,
      });
      if (error) throw error;

      toast.success("성적이 등록되었습니다");
      setForm({ assignment_name: "", round: form.round + 1, written_date: new Date().toISOString().slice(0, 10), reading: 0, content_understanding: 0, problem_understanding: 0, composition: 0, format: 0, feedback: "" });
      setPdfFile(null);
    } catch (err: any) {
      toast.error(err.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const ScoreInput = ({ label, field }: { label: string; field: keyof typeof form }) => (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        max={20}
        value={form[field] as number}
        onChange={e => setForm({ ...form, [field]: Number(e.target.value) })}
        className="text-center"
      />
    </div>
  );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">성적 입력</h2>
          <p className="text-sm text-muted-foreground">학생의 논술 성적을 입력하세요</p>
        </div>

        <div className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-card">
          {/* Class & Student selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>반 선택</Label>
              <Select value={selectedClass} onValueChange={v => { setSelectedClass(v); setSelectedStudent(""); }}>
                <SelectTrigger><SelectValue placeholder="반 선택" /></SelectTrigger>
                <SelectContent>
                  {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>학생 선택 *</Label>
              <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                <SelectTrigger><SelectValue placeholder="학생 선택" /></SelectTrigger>
                <SelectContent>
                  {filteredStudents.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.student_code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignment info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>과제명 *</Label>
              <Input value={form.assignment_name} onChange={e => setForm({ ...form, assignment_name: e.target.value })} placeholder="예: 2026 수능 대비" />
            </div>
            <div className="grid gap-2">
              <Label>회차</Label>
              <Input type="number" min={1} value={form.round} onChange={e => setForm({ ...form, round: Number(e.target.value) })} />
            </div>
            <div className="grid gap-2">
              <Label>작성일</Label>
              <Input type="date" value={form.written_date} onChange={e => setForm({ ...form, written_date: e.target.value })} />
            </div>
          </div>

          {/* Sub-scores */}
          <div>
            <Label className="mb-2 block text-sm font-semibold">세부 점수 (각 0-20점)</Label>
            <div className="grid grid-cols-5 gap-3">
              <ScoreInput label="독해력" field="reading" />
              <ScoreInput label="내용이해" field="content_understanding" />
              <ScoreInput label="문제이해" field="problem_understanding" />
              <ScoreInput label="구성력" field="composition" />
              <ScoreInput label="형식" field="format" />
            </div>
          </div>

          {/* Total & Grade */}
          <div className="flex items-center gap-6 rounded-lg bg-muted p-4">
            <div>
              <p className="text-xs text-muted-foreground">총점</p>
              <p className="text-2xl font-bold text-foreground">{totalScore}점</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">등급</p>
              <p className={`text-2xl font-bold ${
                grade === "A" ? "text-success" : grade === "B" ? "text-primary-accent" : grade === "C" ? "text-warning" : "text-destructive"
              }`}>{grade}</p>
            </div>
          </div>

          {/* Feedback */}
          <div className="grid gap-2">
            <Label>피드백</Label>
            <Textarea value={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.value })} rows={3} placeholder="학생에게 전달할 피드백을 입력하세요" />
          </div>

          {/* PDF Upload */}
          <div className="grid gap-2">
            <Label>첨삭 PDF 업로드</Label>
            <Input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files?.[0] || null)} />
            {pdfFile && <p className="text-xs text-muted-foreground">{pdfFile.name}</p>}
          </div>

          <Button onClick={handleSubmit} disabled={saving} className="w-full bg-primary text-primary-foreground">
            {saving ? "저장 중..." : "성적 저장"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TeacherScoreEntry;
