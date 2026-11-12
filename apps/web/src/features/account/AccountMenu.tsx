import { useEffect, useRef, useState } from "react"
import { ArrowRightLeft, ChevronRight, LogOut, Settings, ShieldCheck } from "lucide-react"
import { listLoginAccounts, signOutAccount, switchLocalAccount, type LoginAccount } from "@/accountActions"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SettingsDialog } from "@/features/settings/SettingsDialog"
import { useClientUpdater } from "@/features/settings/useClientUpdater"
import { useAccount } from "./useAccount"
import { LocalAccountSettings } from "./LocalAccountSettings"

function AccountAvatar({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <Avatar className="size-9 shrink-0">
      <AvatarImage src={avatar} alt={`${name}的头像`} referrerPolicy="no-referrer" />
      <AvatarFallback>{Array.from(name)[0]?.toLocaleUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

function SwitchAccountDialog({ currentId, onClose, onCloseAutoFocus }: {
  currentId: string
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const [accounts, setAccounts] = useState<LoginAccount[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    void listLoginAccounts().then(
      (history) => { if (active) setAccounts(history.filter(account => account.id !== currentId)) },
      () => { if (active) setError(true) },
    )
    return () => { active = false }
  }, [currentId])

  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="sm:max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>切换账号</DialogTitle>
        <DialogDescription>选择在本机登录过的账号。</DialogDescription>
      </DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">无法读取历史账号。</p>
        : !accounts ? <p role="status" className="text-sm text-muted-foreground">正在读取历史账号…</p>
          : accounts.length === 0 ? <p className="text-sm text-muted-foreground">还没有其他历史账号。</p>
            : <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
              {accounts.map(account => <Button key={account.id} variant="outline" className="h-auto min-h-12 w-full justify-between px-3 py-2 text-left"
                onClick={() => { onClose(); void switchLocalAccount(account.id) }}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{account.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{account.email ?? "GitHub"}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{account.password_saved ? "直接切换" : "需要登录"}</span>
              </Button>)}
            </div>}
      <Button variant="ghost" onClick={() => { onClose(); void signOutAccount() }}>使用其他账号</Button>
    </DialogContent>
  </Dialog>
}

export function AccountMenu() {
  const { state, phase, actionError } = useAccount()
  const { phase: updatePhase, update } = useClientUpdater()
  const [settingsTab, setSettingsTab] = useState<"ai" | "updates" | null>(null)
  const [accountSettings, setAccountSettings] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const user = state.user
  if (!user) return null

  const name = user.name.trim() || user.email?.trim() || "当前账号"
  const busy = phase !== "idle"
  const hasUpdate = update !== null && updatePhase !== "latest"

  return (
    <div className="shrink-0 p-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            disabled={busy}
            aria-label={`账号菜单：${name}${hasUpdate ? "，有客户端更新" : ""}`}
            className="h-auto min-h-16 w-full justify-start gap-3 rounded-xl px-3 py-2.5 data-[state=open]:bg-sidebar-accent"
          >
            <AccountAvatar name={name} avatar={user.avatar} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
              <span className="truncate font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{phase === "saving" ? "正在保存资料…" : phase === "switching" ? "正在切换账号…" : "已登录"}</span>
            </span>
            {hasUpdate ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
            <ChevronRight data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-56">
          <DropdownMenuLabel className="flex items-center gap-3 px-3 py-3">
            <AccountAvatar name={name} avatar={user.avatar} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate">{name}</span>
              {user.email ? <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span> : null}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={busy} onSelect={() => setAccountSettings(true)}><ShieldCheck />账号与安全</DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => setSettingsTab(hasUpdate ? "updates" : "ai")}>
              <Settings />设置
              {hasUpdate ? <Badge variant="secondary" className="ml-auto">有更新</Badge> : null}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={busy} onSelect={() => setSwitchingAccount(true)}><ArrowRightLeft />切换账号</DropdownMenuItem>
            <DropdownMenuItem disabled={busy} variant="destructive" onSelect={() => void signOutAccount()}><LogOut />退出登录</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <p className="px-3 py-2 text-xs text-muted-foreground">资料仅保存在本机</p>
        </DropdownMenuContent>
      </DropdownMenu>
      {actionError ? <p role="alert" className="px-3 pt-2 text-xs leading-5 break-words text-destructive">{actionError}</p> : null}
      {switchingAccount ? <SwitchAccountDialog currentId={user.id} onClose={() => setSwitchingAccount(false)}
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }} /> : null}
      {accountSettings ? <LocalAccountSettings key={user.id} user={user} onClose={() => setAccountSettings(false)}
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }} /> : null}
      {settingsTab ? <SettingsDialog open initialTab={settingsTab}
        onOpenChange={(open) => { if (!open) setSettingsTab(null) }}
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }} /> : null}
    </div>
  )
}
