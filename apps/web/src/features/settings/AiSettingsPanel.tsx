import { useEffect, useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { clearModelApiKey, getModelSettings, updateModelSettings } from "@/agentHost"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { ModelSettingsResponse } from "@typedance/contracts"

export function AiSettingsPanel() {
  const [settings, setSettings] = useState<ModelSettingsResponse | null>(null)
  const [model, setModel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getModelSettings()
      .then((value) => {
        if (cancelled) return
        applySettings(value)
      })
      .catch(() => {
        if (!cancelled) toast.error("模型设置加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function applySettings(value: ModelSettingsResponse) {
    setSettings(value)
    setModel(value.model)
    setBaseUrl(value.base_url)
    setApiKey("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!model.trim() || !baseUrl.trim() || saving) return
    setSaving(true)
    try {
      const value = await updateModelSettings({
        model: model.trim(),
        base_url: baseUrl.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      })
      applySettings(value)
      toast.success("模型设置已保存")
    } catch {
      toast.error("模型设置保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleClearApiKey() {
    if (clearing) return
    setClearing(true)
    try {
      applySettings(await clearModelApiKey())
      setClearConfirmationOpen(false)
      toast.success("API Key 已清除")
    } catch {
      toast.error("API Key 清除失败")
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">AI 设置</h2>
            <p className="text-sm text-muted-foreground">配置保存在本机，仅用于 AI 对话。</p>
          </div>
          <form id="ai-settings-form" onSubmit={(event) => void handleSubmit(event)}>
            <FieldGroup className="gap-4">
              <Field data-disabled={loading}>
                <FieldLabel htmlFor="ai-settings-model">模型</FieldLabel>
                <Input
                  id="ai-settings-model"
                  value={model}
                  disabled={loading}
                  onChange={(event) => setModel(event.target.value)}
                />
              </Field>
              <Field data-disabled={loading}>
                <FieldLabel htmlFor="ai-settings-base-url">Base URL</FieldLabel>
                <Input
                  id="ai-settings-base-url"
                  type="url"
                  value={baseUrl}
                  disabled={loading}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </Field>
              <Field data-disabled={loading}>
                <FieldLabel htmlFor="ai-settings-api-key">API Key</FieldLabel>
                <Input
                  id="ai-settings-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  disabled={loading}
                  placeholder="输入新密钥以替换当前配置"
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <FieldDescription>
                  {settings?.api_key.configured
                    ? `已配置 ${settings.api_key.preview ?? ""}`
                    : "尚未配置；不影响编辑、导入和导出功能。"}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
          <div className="flex justify-end gap-2">
            {settings?.api_key.configured ? (
              <Button type="button" variant="outline" disabled={clearing || saving} onClick={() => setClearConfirmationOpen(true)}>
                清除密钥
              </Button>
            ) : null}
            <Button type="submit" form="ai-settings-form" disabled={loading || saving || !model.trim() || !baseUrl.trim()}>
              {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              保存
            </Button>
          </div>
      </div>

      <AlertDialog open={clearConfirmationOpen} onOpenChange={setClearConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清除 API Key？</AlertDialogTitle>
            <AlertDialogDescription>清除后 AI 对话将不可用，其他本机功能不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={clearing} onClick={(event) => {
              event.preventDefault()
              void handleClearApiKey()
            }}>
              {clearing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              确认清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
