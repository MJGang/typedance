import { useEffect, type ReactNode } from "react"
import { toast } from "sonner"
import { Loader2, LockKeyhole, LogIn, Minus, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { closeDesktopWindow, minimizeDesktopWindow } from "@/desktopWindow"
import { cancelAccountSignIn, finishAccountLock, importLocalAccountData, signInAccount, skipLocalAccountData } from "@/accountActions"
import { connectAccountState, refreshAccountState, type AccountProvider } from "@/accountState"
import { captureAccountSession } from "@/accountSession"
import { useAccount } from "./useAccount"
import { AccountProviderIcon } from "./AccountProviderIcon"

const providerNames: Record<AccountProvider, string> = { github: "GitHub", google: "Google", wechat: "微信" }
const providerOrder: AccountProvider[] = ["wechat", "google", "github"]

function AccountWindowControls() {
  return <>
    <div data-tauri-drag-region aria-hidden="true" className="absolute inset-x-0 top-0 h-14" />
    <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
      <Button variant="ghost" size="icon" className="rounded-lg" aria-label="最小化" onClick={() => void minimizeDesktopWindow()}><Minus data-icon="inline-start" /></Button>
      <Button variant="ghost" size="icon" className="rounded-lg" aria-label="关闭" onClick={() => void closeDesktopWindow()}><X data-icon="inline-start" /></Button>
    </div>
  </>
}

function AccountScreen() {
  const { state, phase, actionError } = useAccount()
  const signingIn = state.status === "signing_in"
  const loading = state.status === "restoring" || signingIn || phase === "switching"
  const needsImport = state.status === "needs_import"
  const isLocking = state.status === "locking"
  const title = needsImport ? "处理已有本机资料" : isLocking ? "先保存，再继续" : "欢迎使用 TypeDance"
  const description = needsImport ? `当前账号：${state.user?.name || state.user?.email || "已登录账号"}`
    : isLocking ? "登录已失效，正在保护你的资料。" : "登录，开启你的简历工作台"

  return <div data-account-screen className="relative min-h-svh bg-linear-to-b from-muted to-card to-60% text-foreground [--background:#ffffff] [--card:#ffffff] [--foreground:#1c2638] [--primary:#24292f] [--primary-foreground:#ffffff] [--muted:#edf4fd] [--muted-foreground:#68768a] [--border:#dce4ee] [--input:color-mix(in_srgb,var(--card)_80%,var(--border))] [--accent:#edf3fb] [--accent-foreground:#1c2638]">
    <AccountWindowControls />
    <div className="min-h-svh">
      <main aria-labelledby="account-screen-heading" className="flex min-h-svh min-w-0 flex-col px-7 pt-16 pb-9 sm:px-10">
        <div className="mx-auto my-auto flex w-full max-w-[21rem] flex-col gap-7">
          <div className="flex flex-col items-center gap-3 text-center">
            <img src="/images/typedance-icon.png" alt="" aria-hidden="true" className="mb-3 size-18 shrink-0 select-none" />
            <h1 id="account-screen-heading" className="text-2xl leading-tight font-semibold tracking-tight text-balance">{title}</h1>
            <p className="text-sm leading-6 break-words text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-col gap-4">
            {actionError || state.error ? <p role="alert" className="text-sm leading-6 break-words text-destructive">{actionError || state.error}</p> : null}
            {isLocking ? <>
              <p className="text-sm leading-6 text-muted-foreground">工作区已锁定。完成当前内容保存后，可以重新登录；保存失败时内容会保留。</p>
              {phase === "saving" ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />正在保存资料…</p>
                : <Button className="h-12 w-full rounded-xl" onClick={() => void finishAccountLock()}>重试保存</Button>}
            </> : needsImport ? <>
              <p className="text-sm leading-6 text-muted-foreground">这台设备上有 {state.legacy?.file_count ?? 0} 个尚未归属账号的资料文件。归入后，仅当前账号可以在应用中访问这些资料。</p>
              <p className="text-sm leading-6 text-muted-foreground">如果存在旧模型密钥，确认归入也会将其安全保存到当前账号，校验成功后清除原明文副本。请确认资料和密钥都属于当前账号。</p>
              <div className="flex flex-col gap-3 pt-1">
                <Button className="h-12 w-full rounded-xl" disabled={phase !== "idle"} onClick={() => void importLocalAccountData()}>归入当前账号</Button>
                <Button className="h-12 w-full rounded-xl" variant="outline" disabled={phase !== "idle"} onClick={() => void skipLocalAccountData()}>暂不归入，进入工作区</Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">暂不归入会保留原资料，不会删除或自动分给其他账号，也不会迁移旧模型密钥。</p>
            </> : loading ? <>
              <p role="status" className="flex items-start gap-2.5 text-sm leading-6 text-muted-foreground"><Loader2 className="mt-1 size-4 shrink-0 animate-spin motion-reduce:animate-none" />{signingIn ? "请在浏览器中完成登录，然后返回这里。" : phase === "switching" ? "正在更新账号状态…" : "正在恢复登录状态…"}</p>
              {signingIn ? <Button className="h-12 w-full rounded-xl" variant="outline" onClick={() => void cancelAccountSignIn()}>取消登录</Button> : null}
            </> : state.configured ? <>
              <div className="flex flex-col gap-3">
                {state.providers.length ? providerOrder.filter(provider => state.providers.includes(provider)).map((provider, index) => <Button key={provider} className="h-12 w-full gap-3 rounded-xl" variant={index === 0 ? "default" : "outline"} onClick={() => void signInAccount(provider)}>
                  <AccountProviderIcon provider={provider} />
                  使用{provider === "wechat" ? "" : " "}{providerNames[provider]}{provider === "wechat" ? "" : " "}登录
                </Button>) : <Button className="h-12 w-full rounded-xl" onClick={() => void signInAccount()}><LogIn data-icon="inline-start" />登录或注册</Button>}
              </div>
              <p className="pt-2 text-center text-xs leading-5 text-muted-foreground">首次登录将自动创建账号</p>
            </> : <>
              <p className="text-sm leading-6 text-muted-foreground">登录服务尚未配置，请联系应用提供方完成设置后重试。</p>
              <Button className="h-12 w-full gap-2 rounded-xl" variant="outline" onClick={() => void refreshAccountState().catch(() => {})}><RefreshCw data-icon="inline-start" />重新检查</Button>
            </>}
          </div>
          <div className="flex flex-col gap-5 pt-1">
            <Separator />
            <p className="flex items-start justify-center gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />资料保存在本机，按账号独立管理</p>
          </div>
        </div>
      </main>
    </div>
  </div>
}

export function AccountGate({ children }: { children: ReactNode }) {
  const { state, phase } = useAccount()
  useEffect(connectAccountState, [])
  useEffect(() => { toast.dismiss() }, [state.session?.id])
  useEffect(() => {
    if (state.status === "locking") void finishAccountLock()
  }, [state.revision, state.status])
  useEffect(() => {
    if (state.status !== "locking" && phase === "idle") return
    // Portaled dialogs sit outside the keyed business subtree. Freeze and hide them too.
    const changed = new Map<HTMLElement, { inert: boolean; hidden: boolean }>()
    const freezePortals = () => {
      const shell = document.querySelector("[data-account-shell]")
      for (const child of document.body.children) {
        if (!(child instanceof HTMLElement) || child.contains(shell) || child.tagName === "SCRIPT") continue
        if (!changed.has(child)) changed.set(child, { inert: child.inert, hidden: child.hidden })
        child.inert = true
        child.hidden = true
      }
    }
    const blockBusinessEvent = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-account-screen]")) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    freezePortals()
    const observer = new MutationObserver(freezePortals)
    observer.observe(document.body, { childList: true })
    const eventTypes = ["pointerdown", "click", "keydown", "submit"]
    for (const type of eventTypes) document.addEventListener(type, blockBusinessEvent, true)
    return () => {
      observer.disconnect()
      for (const type of eventTypes) document.removeEventListener(type, blockBusinessEvent, true)
      for (const [element, previous] of changed) { element.inert = previous.inert; element.hidden = previous.hidden }
    }
  }, [phase, state.status])
  const keepWorkspace = (state.status === "ready" || state.status === "locking") && state.session && phase !== "switching"
  const workspaceKey = keepWorkspace ? `${state.session!.id}:${captureAccountSession().epoch}` : undefined
  return <div data-account-shell>
    {keepWorkspace ? <div key={workspaceKey} hidden={state.status === "locking"} inert={phase === "saving" || state.status === "locking"} aria-hidden={state.status === "locking" || undefined}>
      {children}
    </div> : null}
    {state.status !== "ready" || phase === "switching" ? <AccountScreen /> : null}
    {state.status === "ready" && phase === "saving" ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90" role="status" aria-live="polite">正在保存资料并结束当前账号的任务…</div> : null}
  </div>
}
