import { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toDrivePreviewUrl } from "@/lib/drive";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  FileText,
  Pencil,
  Trash2,
  Save,
  X,
} from "lucide-react";

type ClassDoc = {
  id: string;
  name: string;
  description?: string;
  createdAt?: number;
};

type MaterialDoc = {
  id: string;
  title: string;
  driveUrl: string;
  previewUrl: string | null;
  classId: string;
  className?: string;
  createdAt?: number;
};

const ClassMaterialSection = () => {
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [materials, setMaterials] = useState<MaterialDoc[]>([]);

  const [className, setClassName] = useState("");
  const [classDesc, setClassDesc] = useState("");

  const [matTitle, setMatTitle] = useState("");
  const [matUrl, setMatUrl] = useState("");
  const [matClassId, setMatClassId] = useState<string>("");

  const [editingMaterial, setEditingMaterial] = useState<MaterialDoc | null>(null);

  useEffect(() => {
    const q = query(collection(db, "classes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: ClassDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        list.push({
          id: d.id,
          name: data.name,
          description: data.description,
          createdAt: data.createdAt,
        });
      });
      setClasses(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "materials"), orderBy("createdAt", "desc"));
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
          createdAt: data.createdAt,
        });
      });
      setMaterials(list);
    });
    return () => unsub();
  }, []);

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim()) return;
    await addDoc(collection(db, "classes"), {
      name: className.trim(),
      description: classDesc.trim() || null,
      createdAt: Date.now(),
    });
    setClassName("");
    setClassDesc("");
  };

  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matTitle.trim() || !matUrl.trim() || !matClassId) return;
    const cls = classes.find((c) => c.id === matClassId);
    const previewUrl = toDrivePreviewUrl(matUrl.trim());

    await addDoc(collection(db, "materials"), {
      title: matTitle.trim(),
      driveUrl: matUrl.trim(),
      previewUrl,
      classId: matClassId,
      className: cls?.name ?? "",
      createdAt: Date.now(),
    });

    setMatTitle("");
    setMatUrl("");
    setMatClassId("");
  };

  const handleUpdateMaterial = async () => {
    if (!editingMaterial) return;
    const ref = doc(db, "materials", editingMaterial.id);
    const previewUrl = toDrivePreviewUrl(editingMaterial.driveUrl);
    await updateDoc(ref, {
      title: editingMaterial.title,
      driveUrl: editingMaterial.driveUrl,
      previewUrl,
      classId: editingMaterial.classId,
      className:
        classes.find((c) => c.id === editingMaterial.classId)?.name ?? "",
    });
    setEditingMaterial(null);
  };

  const handleDeleteMaterial = async (id: string) => {
    await deleteDoc(doc(db, "materials", id));
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-50">
          반 관리 및 자료 배포
        </h2>
        <p className="text-sm text-slate-400">
          반을 생성하고, 각 반에 배포할 PDF 자료를 등록하세요.
        </p>
      </div>

      {/* Class creation */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 lg:col-span-1">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
            <FileText className="h-4 w-4 text-sky-400" />
            반 생성
          </h3>
          <form onSubmit={handleCreateClass} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">
                반 이름
              </label>
              <Input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="예: 고2 심화반 A"
                className="border-slate-700 bg-slate-900 text-slate-50 placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">
                설명 (선택)
              </label>
              <Input
                value={classDesc}
                onChange={(e) => setClassDesc(e.target.value)}
                placeholder="예: 주 2회, 논리/표현력 집중반"
                className="border-slate-700 bg-slate-900 text-slate-50 placeholder:text-slate-500"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-sky-500 text-slate-950 hover:bg-sky-400"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              반 생성
            </Button>
          </form>
        </div>

        {/* Material creation + list */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <FileText className="h-4 w-4 text-sky-400" />
              PDF 자료 등록
            </h3>
            <form
              onSubmit={handleCreateMaterial}
              className="grid gap-3 md:grid-cols-2"
            >
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  자료명
                </label>
                <Input
                  value={matTitle}
                  onChange={(e) => setMatTitle(e.target.value)}
                  placeholder="예: 3월 모의고사 분석"
                  className="border-slate-700 bg-slate-900 text-slate-50 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-slate-300">
                  구글 드라이브 링크
                </label>
                <Input
                  value={matUrl}
                  onChange={(e) => setMatUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="border-slate-700 bg-slate-900 text-slate-50 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  대상 반
                </label>
                <Select
                  value={matClassId}
                  onValueChange={(v) => setMatClassId(v)}
                >
                  <SelectTrigger className="border-slate-700 bg-slate-900 text-slate-50">
                    <SelectValue placeholder="대상 반 선택" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 text-slate-50">
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end justify-end md:col-span-2">
                <Button
                  type="submit"
                  className="bg-sky-500 text-slate-950 hover:bg-sky-400"
                  disabled={!matTitle || !matUrl || !matClassId}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  자료 등록
                </Button>
              </div>
            </form>
          </div>

          {/* Materials table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                등록된 PDF 리스트
              </h3>
              <span className="text-xs text-slate-500">
                총 {materials.length}개
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-900/80">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                      자료명
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                      반
                    </th>
                    <th className="hidden px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400 lg:table-cell">
                      링크
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">
                      액션
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                  {materials.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2 text-slate-100">
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-sky-400" />
                          <span>{m.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-300">
                        {m.className || "—"}
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-2 text-xs text-slate-500 lg:table-cell">
                        {m.driveUrl}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800"
                            onClick={() => setEditingMaterial(m)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 border-slate-800 bg-slate-900/80 text-red-400 hover:bg-red-900/40"
                            onClick={() => handleDeleteMaterial(m.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {materials.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-xs text-slate-500"
                      >
                        아직 등록된 자료가 없습니다. 상단 폼을 사용해 첫 자료를
                        등록해보세요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog
        open={!!editingMaterial}
        onOpenChange={(open) => !open && setEditingMaterial(null)}
      >
        <DialogContent className="max-w-lg border-slate-800 bg-slate-900 text-slate-50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-50">
              <Pencil className="h-4 w-4 text-sky-400" />
              자료 수정
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              자료명, 링크, 대상 반을 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {editingMaterial && (
            <div className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  자료명
                </label>
                <Input
                  value={editingMaterial.title}
                  onChange={(e) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      title: e.target.value,
                    })
                  }
                  className="border-slate-700 bg-slate-900 text-slate-50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  구글 드라이브 링크
                </label>
                <Input
                  value={editingMaterial.driveUrl}
                  onChange={(e) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      driveUrl: e.target.value,
                    })
                  }
                  className="border-slate-700 bg-slate-900 text-slate-50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  대상 반
                </label>
                <Select
                  value={editingMaterial.classId}
                  onValueChange={(v) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      classId: v,
                    })
                  }
                >
                  <SelectTrigger className="border-slate-700 bg-slate-900 text-slate-50">
                    <SelectValue placeholder="대상 반 선택" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 text-slate-50">
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                  onClick={() => setEditingMaterial(null)}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  취소
                </Button>
                <Button
                  className="bg-sky-500 text-slate-950 hover:bg-sky-400"
                  onClick={handleUpdateMaterial}
                >
                  <Save className="mr-1 h-3.5 w-3.5" />
                  저장
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClassMaterialSection;

