import { useEffect, useState, type FormEvent } from "react"
import { Github } from "lucide-react"
import { listLoginAccounts, runLocalAccountAction, type LoginAccount } from "@/accountActions"
import { applyAccountState } from "@/accountState"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function RecoveryCode({ code }: { code: string }) {
  return <div className="grid gap-2 rounded-lg border bg-muted p-3 text-sm">
    <p className="font-medium">请妥善保存恢复码</p>
    <p className="text-muted-foreground">忘记密码时可在本机使用。下次设置密码会生成新的恢复码。</p>
    <code className="select-all break-all">{code}</code>
  </div>
}

export function LocalAccountForm({ loginTarget, onGithubSignIn }: {
  loginTarget?: string | null
  onGithubSignIn?: (target?: string) => void
}) {
  const [mode, setMode] = useState<"login" | "register" | "recover">("login")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [code, setCode] = useState("")
  const [accounts, setAccounts] = useState<LoginAccount[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [emailOverride, setEmailOverride] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [rememberOverride, setRememberOverride] = useState<boolean | null>(null)
  const selected = accounts.find(account => account.id === (selectedId ?? loginTarget))
  const login = mode === "login"
  const githubOnly = login && selected && !selected.password_login
  const saved = login && !!selected?.password_saved
  const remember = rememberOverride ?? saved

  useEffect(() => {
    let active = true
    void listLoginAccounts().then(
      (history) => { if (active && history.length) setAccounts(history) },
      () => { if (active) setHistoryError(true) },
    )
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || githubOnly) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get("email"))
    const enteredPassword = String(data.get("password") ?? "")
    const savedAccountId = saved && !enteredPassword ? selected?.id : undefined
    setBusy(true)
    setError("")
    try {
      if (login) {
        const credentials = savedAccountId ? { kind: "saved", account_id: savedAccountId } : { kind: "password", email, password: enteredPassword }
        applyAccountState(await runLocalAccountAction("login_local_account", { credentials, rememberPassword: remember }))
      } else if (mode === "register") {
        setCode(await runLocalAccountAction<string>("register_local_account", { email, password: enteredPassword, name: String(data.get("name")) }))
      } else {
        setCode(await runLocalAccountAction<string>("recover_local_password", { email, password: enteredPassword, recovery: String(data.get("recovery")) }))
        setAccounts(current => current.map(account =>
          account.email === email.trim().toLowerCase() ? { ...account, password_saved: false } : account))
      }
      setPassword("")
      form.reset()
    } catch (cause) {
      setError(String(cause))
      if (savedAccountId) {
        setAccounts(current => current.map(account =>
          account.id === savedAccountId ? { ...account, password_saved: false } : account))
      }
    } finally {
      setBusy(false)
    }
  }

  function changeMode(next: typeof mode) {
    setMode(next)
    setPassword("")
    setError("")
    setCode("")
  }

  function selectAccount(id: string) {
    setSelectedId(id)
    setEmailOverride(null)
    setPassword("")
    setRememberOverride(null)
    setError("")
  }

  if (code) {
    return <div className="grid gap-3">
      <RecoveryCode code={code} />
      <Button className="w-full" onClick={() => changeMode("login")}>返回登录</Button>
    </div>
  }

  return <form key={mode} onSubmit={(event) => void submit(event)} className="grid gap-3">
    <FieldGroup className="gap-3">
      {login && accounts.length > 0 ? <Field className="gap-1.5">
        <FieldLabel htmlFor="login-history">历史账号</FieldLabel>
        <Select value={selected?.id ?? ""} onValueChange={(id) => selectAccount(id === "other" ? "" : id)} disabled={busy}>
          <SelectTrigger id="login-history" className="w-full"><SelectValue placeholder="选择已登录过的账号" /></SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-3.5rem)]"><SelectGroup>
            {accounts.map(account => <SelectItem key={account.id} value={account.id}>
              {account.name} · {account.email ?? "GitHub"}
            </SelectItem>)}
            <SelectItem value="other">使用其他账号</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
      </Field> : null}
      {mode === "register" ? <Field className="gap-1.5">
        <FieldLabel htmlFor="login-name">昵称</FieldLabel>
        <Input id="login-name" required name="name" maxLength={40} autoComplete="nickname" disabled={busy} />
      </Field> : null}
      {!githubOnly ? <Field className="gap-1.5">
        <FieldLabel htmlFor="login-email">邮箱</FieldLabel>
        <Input id="login-email" required name="email" type="email" maxLength={254} autoComplete="username" disabled={busy}
          value={login ? emailOverride ?? selected?.email ?? "" : undefined}
          defaultValue={mode === "recover" ? emailOverride ?? selected?.email ?? "" : undefined}
          onChange={login ? (event) => {
            if (selectedId !== "") selectAccount("")
            setEmailOverride(event.target.value)
          } : undefined} />
      </Field> : null}
      {mode === "recover" ? <Field className="gap-1.5">
        <FieldLabel htmlFor="login-recovery">恢复码</FieldLabel>
        <Input id="login-recovery" required name="recovery" autoComplete="off" disabled={busy} />
      </Field> : null}
      {!githubOnly ? <Field className="gap-1.5">
        <FieldLabel htmlFor="login-password">{mode === "recover" ? "新密码" : "密码"}</FieldLabel>
        <Input id="login-password" required={!saved} name="password" type="password" minLength={login ? undefined : 8} maxLength={1024}
          autoComplete={login ? "current-password" : "new-password"} disabled={busy}
          placeholder={saved ? "已保存密码" : undefined} value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field> : null}
      {login && !githubOnly ? <Field orientation="horizontal" className="gap-2">
        <Checkbox id="remember-login-password" checked={remember} onCheckedChange={(checked) => setRememberOverride(checked === true)} disabled={busy} />
        <Label htmlFor="remember-login-password">记住密码</Label>
      </Field> : null}
    </FieldGroup>
    {login && historyError ? <p className="text-xs text-muted-foreground">暂时无法读取历史账号，可以手动登录。</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {!githubOnly ? <Button className="w-full" disabled={busy} type="submit">
      {mode === "login" ? "登录 TypeDance" : mode === "register" ? "创建本机账号" : "重置密码"}
    </Button> : null}
    <div className="flex justify-center gap-2">
      {mode === "login" ? <>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeMode("register")}>创建账号</Button>
        {!githubOnly ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeMode("recover")}>忘记密码</Button> : null}
      </> : <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeMode("login")}>返回登录</Button>}
    </div>
    {mode === "login" && onGithubSignIn ? <>
      <Button type="button" variant={githubOnly ? "default" : "outline"} disabled={busy}
        onClick={() => onGithubSignIn(selected?.github_bound ? selected.id : undefined)}>
        <Github data-icon="inline-start" aria-hidden="true" />使用 GitHub 登录
      </Button>
      {!selected ? <p className="text-xs text-muted-foreground">已有本机账号时，请先登录，再到「账号与安全」绑定 GitHub。</p> : null}
    </> : null}
  </form>
}
