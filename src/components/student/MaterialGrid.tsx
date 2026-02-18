import { FileText } from "lucide-react";

interface MaterialGridItem {
  id: string;
  title: string;
  className?: string;
}

interface MaterialGridProps {
  items: MaterialGridItem[];
  onSelect: (id: string) => void;
}

const MaterialGrid = ({ items, onSelect }: MaterialGridProps) => {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((m) => (
        <button
          key={m.id}
          onClick={() => onSelect(m.id)}
          className="flex flex-col items-start rounded-lg border border-border bg-background p-4 text-left shadow-sm transition hover:border-primary hover:shadow-md"
        >
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </div>
            <p className="text-sm font-semibold text-card-foreground">
              {m.title}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {m.className || "배정 반"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            클릭하면 새 창 없이 바로 PDF를 확인할 수 있습니다.
          </p>
        </button>
      ))}
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          아직 이 반에 배포된 자료가 없습니다. 추후 관리자가 업로드하면 이곳에
          표시됩니다.
        </p>
      )}
    </div>
  );
};

export default MaterialGrid;

