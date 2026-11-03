import type { TemplateStyleConfig } from "@typedance/contracts"
import { DEFAULT_TIMELINE_STYLE } from "@typedance/resume-renderer"
import { FieldGroup } from "@/components/ui/field"
import { PixelInput } from "./controls/PixelInput"

type TimelineStyle = NonNullable<TemplateStyleConfig["blocks"]["timeline"]>

export function TimelineStyleEditor({ value, onChange }: { value?: TimelineStyle; onChange: (style: TimelineStyle) => void }) {
  const style = { ...DEFAULT_TIMELINE_STYLE, ...value }
  return (
    <FieldGroup className="gap-4 p-3">
      <p className="m-0 text-xs leading-5 text-muted-foreground">统一调整时间轴条目的内边距。支持输入 0；最后一个节点不额外添加底部留白。</p>
      <PixelInput key={`left-${style.paddingLeft}`} label="节点左侧内边距" value={style.paddingLeft} onChange={(paddingLeft) => onChange({ ...value, paddingLeft })} />
      <PixelInput key={`bottom-${style.paddingBottom}`} label="节点底部内边距" value={style.paddingBottom} onChange={(paddingBottom) => onChange({ ...value, paddingBottom })} />
    </FieldGroup>
  )
}
