import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface AccountRow {
  user_id: string;
  role: string;
  name: string | null;
}

const ManageAccounts = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "teacher" as string });

  const fetchAccounts = async () => {
    setLoading(true);
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    if (roles && roles.length > 0) {
      const ids = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, name").in("id", ids);
      const merged = roles.map((r: any) => ({
        user_id: r.user_id,
        role: r.role,
        name: profiles?.find((p: any) => p.id === r.user_id)?.name || null,
      }));
      setAccounts(merged);
    } else {
      setAccounts([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, []);

  const handleCreate = async () => {
    try {
      // Sign up new user via edge function or admin API
      // For now, use supabase.auth.signUp (this creates the user)
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { name: form.name } },
      });
      if (error) throw error;
      if (!data.user) throw new Error("사용자 생성에 실패했습니다");

      // Insert role
      const { error: roleError } = await supabase.from("user_roles").insert([{
        user_id: data.user.id,
        role: form.role as "admin" | "teacher" | "student",
      }]);
      if (roleError) throw roleError;

      toast.success(`${form.role === "teacher" ? "강사" : "학생"} 계정이 생성되었습니다`);
      setDialogOpen(false);
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.message || "계정 생성 실패");
    }
  };

  const roleLabel = (role: string) => {
    switch (role) {
      case "admin": return "관리자";
      case "teacher": return "강사";
      case "student": return "학생";
      default: return role;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">계정 관리</h2>
            <p className="text-sm text-muted-foreground">강사 및 학생 계정</p>
          </div>
          <Button onClick={() => { setForm({ email: "", password: "", name: "", role: "teacher" }); setDialogOpen(true); }} className="bg-primary text-primary-foreground">
            <UserPlus className="mr-2 h-4 w-4" /> 계정 생성
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">불러오는 중...</TableCell></TableRow>
              ) : accounts.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">등록된 계정이 없습니다</TableCell></TableRow>
              ) : accounts.map(a => (
                <TableRow key={a.user_id}>
                  <TableCell className="font-medium">{a.name || "-"}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.role === "admin" ? "bg-primary/10 text-primary-accent" :
                      a.role === "teacher" ? "bg-accent/10 text-accent" :
                      "bg-muted text-muted-foreground"
                    }`}>{roleLabel(a.role)}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.user_id.slice(0, 8)}...</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>계정 생성</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>이름 *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>이메일 *</Label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>비밀번호 *</Label>
                <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>역할 *</Label>
                <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teacher">강사</SelectItem>
                    <SelectItem value="student">학생</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
              <Button onClick={handleCreate} className="bg-primary text-primary-foreground">생성</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default ManageAccounts;
