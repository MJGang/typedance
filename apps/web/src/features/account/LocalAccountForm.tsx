import { useState, type FormEvent } from "react"
import { Github } from "lucide-react"
import { runLocalAccountAction } from "@/accountActions"
import { applyAccountState } from "@/accountState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function RecoveryCode({ code }: { code: string }) {
  return <div className="grid gap-2 rounded-lg border bg-muted p-3 text-sm">
    <p className="font-medium">请妥善保存恢复码</p>
    <p className="text-muted-foreground">忘记密码时可在本机使用。下次设置密码会生成新的恢复码。</p>
    <code className="select-all break-all">{code}</code>
  </div>
}

export function LocalAccountForm({ onGithubSignIn }: { onGithubSignIn?: () => void }) {
  const [mode, setMode] = useState<"login" | "register" | "recover">("login")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [code, setCode] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get("email"))
    const password = String(data.get("password"))
    setBusy(true)
    setError("")
    try {
      if (mode === "login") {
        applyAccountState(await runLocalAccountAction("login_local_account", { email, password }))
      } else if (mode === "register") {
        setCode(await runLocalAccountAction<string>("register_local_account", { email, password, name: String(data.get("name")) }))
      } else {
        setCode(await runLocalAccountAction<string>("recover_local_password", { email, password, recovery: String(data.get("recovery")) }))
      }
      form.reset()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  function changeMode(next: typeof mode) {
    setMode(next)
    setError("")
    setCode("")
  }

  if (code) {
    return <div className="grid gap-3">
      <RecoveryCode code={code} />
      <Button className="w-full" onClick={() => changeMode("login")}>返回登录</Button>
    </div>
  }

  return <form key={mode} onSubmit={(event) => void submit(event)} className="grid gap-3">
    {mode === "register" ? <Label className="grid gap-1.5">
      昵称 <Input required name="name" maxLength={40} autoComplete="nickname" />
    </Label> : null}
    <Label className="grid gap-1.5">
      邮箱 <Input required name="email" type="email" maxLength={254} autoComplete="username" />
    </Label>
    {mode === "recover" ? <Label className="grid gap-1.5">
      恢复码 <Input required name="recovery" autoComplete="off" />
    </Label> : null}
    <Label className="grid gap-1.5">
      {mode === "recover" ? "新密码" : "密码"}
      <Input required name="password" type="password" minLength={mode === "login" ? undefined : 8} maxLength={1024}
        autoComplete={mode === "login" ? "current-password" : "new-password"} />
    </Label>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <Button className="w-full" disabled={busy} type="submit">
      {mode === "login" ? "登录 TypeDance" : mode === "register" ? "创建本机账号" : "重置密码"}
    </Button>
    <div className="flex justify-center gap-2">
      {mode === "login" ? <>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeMode("register")}>创建账号</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeMode("recover")}>忘记密码</Button>
      </> : <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeMode("login")}>返回登录</Button>}
    </div>
    {mode === "login" && onGithubSignIn ? <>
      <Button type="button" variant="outline" disabled={busy} onClick={onGithubSignIn}>
        <Github data-icon="inline-start" aria-hidden="true" />使用 GitHub 登录
      </Button>
      <p className="text-xs text-muted-foreground">已有本机账号时，请先登录，再到「账号与安全」绑定 GitHub。</p>
    </> : null}
  </form>
}
