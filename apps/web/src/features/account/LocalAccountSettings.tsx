import { useState, type FormEvent } from "react"
import { invoke } from "@tauri-apps/api/core"
import { applyAccountState, type AccountState } from "@/accountState"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { RecoveryCode } from "./LocalAccountForm"
import { useAccount } from "./useAccount"

async function prepareAvatar(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("请选择 5 MB 以内的 PNG、JPEG 或 WebP 图片。")
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 128
    canvas.height = 128
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法读取头像图片。")
    const crop = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, 128, 128)
    return canvas.toDataURL("image/png")
  } finally {
    bitmap.close()
  }
}

export function LocalAccountSettings({
  user, onClose, onCloseAutoFocus,
}: {
  user: NonNullable<AccountState["user"]>
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const { state } = useAccount()
  const [avatar, setAvatar] = useState(user.avatar)
  const [pending, setPending] = useState<"profile" | "password" | "github" | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [recovery, setRecovery] = useState("")

  async function run(action: NonNullable<typeof pending>, operation: () => Promise<void>) {
    if (pending) return
    setPending(action)
    setError("")
    setMessage("")
    try {
      await operation()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setPending(null)
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run("profile", async () => {
      applyAccountState(await invoke("update_local_account", {
        name: String(data.get("name")), email: String(data.get("email")), avatar: avatar ?? null,
      }))
      setMessage("账号资料已保存。")
    })
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    void run("password", async () => {
      setRecovery(await invoke<string>("change_local_password", { password: String(data.get("password")) }))
      form.reset()
    })
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>账号与安全</DialogTitle>
        <DialogDescription>账号和绑定关系保存在当前 Windows 用户下。</DialogDescription>
      </DialogHeader>
      <form onSubmit={saveProfile} className="grid gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarImage src={avatar} alt="账号头像" />
            <AvatarFallback>{Array.from(user.name)[0]}</AvatarFallback>
          </Avatar>
          <Label className="grid flex-1 gap-1.5">
            头像
            <Input type="file" accept="image/png,image/jpeg,image/webp" disabled={pending !== null}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void run("profile", async () => { setAvatar(await prepareAvatar(file)) })
              }} />
          </Label>
          {avatar ? <Button type="button" size="sm" variant="ghost" disabled={pending !== null} onClick={() => setAvatar(undefined)}>移除</Button> : null}
        </div>
        <Label className="grid gap-1.5">
          昵称 <Input name="name" required maxLength={40} defaultValue={user.name} />
        </Label>
        <Label className="grid gap-1.5">
          本机登录邮箱 <Input name="email" type="email" maxLength={254} defaultValue={user.email} autoComplete="username" />
        </Label>
        <Button type="submit" disabled={pending !== null} className="justify-self-start">保存账号资料</Button>
      </form>
      {state.providers.includes("github") ? <>
        <Separator />
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">GitHub</h3>
          {state.github_bound ? <p className="text-sm text-muted-foreground">已绑定，可登录当前本机账号。</p> : <>
            <Button type="button" variant="outline" className="justify-self-start" disabled={pending !== null}
              onClick={() => void run("github", async () => { applyAccountState(await invoke("bind_github_account")) })}>
              绑定 GitHub
            </Button>
            {pending === "github" ? <div className="grid gap-2 text-sm" role="status">
              <p>在 GitHub 页面输入设备码以完成绑定。</p>
              {state.github_code ? <code className="select-all text-base">{state.github_code}</code> : null}
              <Button type="button" size="sm" variant="ghost" className="justify-self-start"
                onClick={() => void invoke("cancel_account_sign_in").then(applyAccountState).catch((cause) => setError(String(cause)))}>取消授权</Button>
            </div> : null}
          </>}
        </div>
      </> : null}
      <Separator />
      <form onSubmit={changePassword} className="grid gap-3">
        <Label className="grid gap-1.5">
          新密码 <Input name="password" type="password" required minLength={8} maxLength={1024} autoComplete="new-password" />
        </Label>
        <Button type="submit" variant="outline" disabled={!user.email || pending !== null} className="justify-self-start">
          设置或重置密码
        </Button>
        {user.email ? null : <p className="text-sm text-muted-foreground">保存本机登录邮箱后即可设置密码。</p>}
        {recovery ? <RecoveryCode code={recovery} /> : null}
      </form>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>
}
