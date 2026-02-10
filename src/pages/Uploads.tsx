import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { uploadsApi, UploadItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, FileText, FolderOpen } from "lucide-react";
import { toast } from "sonner";

const Uploads = () => {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUpload, setNewUpload] = useState<UploadItem>({ fileName: "", category: "", description: "", url: "" });

  const fetchUploads = async () => {
    setLoading(true);
    try {
      const data = await uploadsApi.getAll();
      setUploads(Array.isArray(data) ? data : []);
    } catch {
      toast.error("자료 목록을 불러오는데 실패했습니다");
      setUploads([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchUploads(); }, []);

  const handleSave = async () => {
    try {
      await uploadsApi.create({ ...newUpload, uploadDate: new Date().toISOString().slice(0, 10) });
      toast.success("자료가 등록되었습니다");
      setDialogOpen(false);
      setNewUpload({ fileName: "", category: "", description: "", url: "" });
      fetchUploads();
    } catch { toast.error("등록에 실패했습니다"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await uploadsApi.delete(id);
      toast.success("삭제되었습니다");
      fetchUploads();
    } catch { toast.error("삭제에 실패했습니다"); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">자료 업로드</h2>
            <p className="text-sm text-muted-foreground">전체 {uploads.length}개 자료</p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary-light">
            <Upload className="mr-2 h-4 w-4" /> 자료 등록
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <p className="col-span-full text-center py-8 text-muted-foreground">불러오는 중...</p>
          ) : uploads.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mb-3 opacity-40" />
              <p>등록된 자료가 없습니다</p>
            </div>
          ) : (
            uploads.map((u, i) => (
              <div key={u.id || i} className="rounded-lg border border-border bg-card p-5 shadow-card">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-accent/10">
                    <FileText className="h-5 w-5 text-primary-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-card-foreground truncate">{u.fileName}</h3>
                    <p className="text-xs text-muted-foreground">{u.category || "미분류"} · {u.uploadDate || "-"}</p>
                    {u.description && <p className="mt-1 text-xs text-muted-foreground truncate">{u.description}</p>}
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {u.url && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={u.url} target="_blank" rel="noopener noreferrer">열기</a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => u.id && handleDelete(u.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>자료 등록</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>파일명 *</Label>
                <Input value={newUpload.fileName} onChange={e => setNewUpload({...newUpload, fileName: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>카테고리</Label>
                <Input value={newUpload.category || ""} onChange={e => setNewUpload({...newUpload, category: e.target.value})} placeholder="예: 수업자료, 모의고사" />
              </div>
              <div className="grid gap-2">
                <Label>URL (Google Drive 등)</Label>
                <Input value={newUpload.url || ""} onChange={e => setNewUpload({...newUpload, url: e.target.value})} placeholder="https://..." />
              </div>
              <div className="grid gap-2">
                <Label>설명</Label>
                <Input value={newUpload.description || ""} onChange={e => setNewUpload({...newUpload, description: e.target.value})} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
              <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary-light">등록</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default Uploads;
