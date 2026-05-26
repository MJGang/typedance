import { useCallback, useEffect, useState } from "react"
import { Loader2, Save, TestTube2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { AgentMode, ModelProvider, ModelSettingsResponse } from "@typedance/contracts"
import {
  clearModelApiKey,
  getModelSettings,
  saveModelSettings,
  testModelSettings,
} from "@/api"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

const providerOptions: Array<{ value: ModelProvider; label: string }> = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "openai_compatible", label: "OpenAI-compatible" },
]

const agentModeOptions: Array<{ value: AgentMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "langchain", label: "真实模型" },
  { value: "rule", label: "本地规则" },
]

const agentRows: Array<{ key: keyof ModelSettingsResponse["agents"]; label: string }> = [
  { key: "parser", label: "Parser" },
  { key: "structurer", label: "Structurer" },
  { key: "reviewer", label: "Reviewer" },
  { key: "rewriter", label: "Rewriter" },
  { key: "opportunity_calibrator", label: "Opportunity Calibrator" },
]

type FormState = ModelSettingsResponse & { api_key_input: string }

function toFormState(settings: ModelSettingsResponse): FormState {
  return { ...settings, api_key_input: "" }
}

function defaultsForProvider(provider: ModelProvider): Pick<ModelSettingsResponse["model"], "model" | "base_url"> {
  if (provider === "deepseek") {
    return { model: "deepseek-v4-flash", base_url: "https://api.deepseek.com" }
  }
  if (provider === "openai") {
    return { model: "gpt-5.4", base_url: null }
  }
  return { model: "gpt-5.4", base_url: null }
}

export function SettingsPage() {
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setForm(toFormState(await getModelSettings()))
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "加载模型设置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave() {
    if (!form) return
    setSaving(true)
    try {
      const saved = await saveModelSettings({
        model: form.model,
        agents: form.agents,
        ...(form.api_key_input.trim() ? { api_key: form.api_key_input.trim() } : {}),
      })
      setForm(toFormState(saved))
      toast.success("模型设置已保存")
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : "保存模型设置失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const result = await testModelSettings()
      toast[result.ok ? "success" : "error"](result.message)
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : "测试模型连接失败")
    } finally {
      setTesting(false)
    }
  }

  async function handleClearKey() {
    setClearing(true)
    try {
      const cleared = await clearModelApiKey()
      setForm(toFormState(cleared))
      toast.success("已清除本机保存的 API Key")
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : "清除 API Key 失败")
    } finally {
      setClearing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (error || !form) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6 text-sm text-destructive">
        {error ?? "模型设置不可用"}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="text-sm text-muted-foreground">{form.config_path}</p>
      </div>

      <FieldSet>
        <FieldGroup>
          <section className="flex flex-col gap-5">
            <FieldTitle>模型</FieldTitle>
            <Field>
              <FieldLabel htmlFor="provider">供应商</FieldLabel>
              <Select
                value={form.model.provider}
                onValueChange={(value) => {
                  const provider = value as ModelProvider
                  setForm({ ...form, model: { ...form.model, provider, ...defaultsForProvider(provider) } })
                }}
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {providerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="model">模型</FieldLabel>
              <Input
                id="model"
                value={form.model.model}
                onChange={(event) => setForm({ ...form, model: { ...form.model, model: event.target.value } })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
              <Input
                id="base-url"
                value={form.model.base_url ?? ""}
                onChange={(event) => setForm({ ...form, model: { ...form.model, base_url: event.target.value || null } })}
              />
            </Field>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="temperature">Temperature</FieldLabel>
                <Input
                  id="temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.model.temperature}
                  onChange={(event) => setForm({ ...form, model: { ...form.model, temperature: Number(event.target.value) } })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="timeout">Timeout seconds</FieldLabel>
                <Input
                  id="timeout"
                  type="number"
                  min={1}
                  value={form.model.timeout_seconds}
                  onChange={(event) => setForm({ ...form, model: { ...form.model, timeout_seconds: Number(event.target.value) } })}
                />
              </Field>
            </FieldGroup>
            <Field orientation="horizontal">
              <Switch
                id="structured-output"
                checked={form.model.structured_output}
                onCheckedChange={(checked) => setForm({ ...form, model: { ...form.model, structured_output: checked } })}
              />
              <FieldLabel htmlFor="structured-output">结构化输出</FieldLabel>
            </Field>
          </section>

          <Separator />

          <section className="flex flex-col gap-5">
            <FieldTitle>API Key</FieldTitle>
            <p className="text-sm text-muted-foreground">
              {form.api_key.source === "env"
                ? "当前由环境变量生效"
                : form.api_key.configured
                  ? `已配置 ${form.api_key.preview ?? ""}`
                  : "未配置"}
            </p>
            <Field>
              <FieldLabel htmlFor="api-key">新 API Key</FieldLabel>
              <Input
                id="api-key"
                type="password"
                value={form.api_key_input}
                onChange={(event) => setForm({ ...form, api_key_input: event.target.value })}
                placeholder="输入后保存到 auth.json"
              />
              <FieldDescription>页面不会展示完整 API Key。</FieldDescription>
            </Field>
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={handleClearKey}
                disabled={form.api_key.source === "env" || clearing}
              >
                {clearing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
                清除本机 Key
              </Button>
            </div>
          </section>

          <Separator />

          <section className="flex flex-col gap-5">
            <FieldTitle>Agent 模式</FieldTitle>
            {agentRows.map((item) => {
              const triggerId = `agent-mode-${item.key}`
              return (
                <Field key={item.key}>
                  <FieldLabel htmlFor={triggerId}>{item.label}</FieldLabel>
                  <Select
                    value={form.agents[item.key]}
                    onValueChange={(value) => setForm({ ...form, agents: { ...form.agents, [item.key]: value as AgentMode } })}
                  >
                    <SelectTrigger id={triggerId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {agentModeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )
            })}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
              保存设置
            </Button>
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <TestTube2 data-icon="inline-start" />}
              测试连接
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </div>
  )
}
