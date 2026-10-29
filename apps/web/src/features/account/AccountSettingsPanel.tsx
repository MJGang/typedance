import { ArrowRightLeft, ExternalLink, LogOut, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openAccountCenter, signInAccount, signOutAccount } from "@/accountActions"
import { useAccount } from "./useAccount"

export function AccountSettingsPanel() {
  const { state, phase, actionError } = useAccount()
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">账号</h2>
      <p className="text-sm text-muted-foreground">当前账号的资料和模型设置保存在本机，切换后互相隔离。</p>
    </div>
    <div className="flex items-center gap-3">
      <UserRound className="size-8 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1"><p className="truncate font-medium">{state.user?.name || "当前账号"}</p>{state.user?.email ? <p className="truncate text-sm text-muted-foreground">{state.user.email}</p> : null}</div>
    </div>
    {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={phase !== "idle"} onClick={() => void openAccountCenter()}><ExternalLink data-icon="inline-start" />管理绑定与安全</Button>
      <Button variant="outline" disabled={phase !== "idle"} onClick={() => void signInAccount()}><ArrowRightLeft data-icon="inline-start" />切换账号</Button>
      <Button variant="outline" disabled={phase !== "idle"} onClick={() => void signOutAccount()}><LogOut data-icon="inline-start" />退出登录</Button>
    </div>
    <p className="text-xs text-muted-foreground">退出保留本机资料。再次使用这些资料需要登录同一账号。</p>
  </div>
}
