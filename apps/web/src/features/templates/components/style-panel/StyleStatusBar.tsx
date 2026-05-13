import { Check, Loader2, AlertCircle } from "lucide-react";

type StyleStatusBarProps = {
  updatedAt: string | null;
  saving: boolean;
  error: string | null;
};

export function StyleStatusBar({ updatedAt, saving, error }: StyleStatusBarProps) {
  const timeAgo = updatedAt
    ? `${Math.max(1, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000))} 分钟前`
    : null;

  if (error) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1">
        <AlertCircle className="size-3 text-destructive" />
        <span className="text-xs text-destructive">{error}</span>
      </div>
    );
  }

  if (saving) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">保存中...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <Check className="size-3 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">
        {timeAgo ? `已保存 · ${timeAgo}` : "未保存"}
      </span>
    </div>
  );
}
