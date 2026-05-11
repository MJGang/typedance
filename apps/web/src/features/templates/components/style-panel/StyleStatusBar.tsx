type StyleStatusBarProps = {
  updatedAt: string | null;
  saving: boolean;
  error: string | null;
};

export function StyleStatusBar({ updatedAt, saving, error }: StyleStatusBarProps) {
  const timeAgo = updatedAt ? `${Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)} 分钟前` : "未保存";

  if (error) return <p className="td-status-error">{error}</p>;
  if (saving) return <p className="td-status-saving">保存中...</p>;
  return <p className="td-status-ok">已保存 {timeAgo}</p>;
}
