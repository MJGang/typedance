import { FileText, LayoutTemplate, Moon, PanelRightOpen, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

export function QuickActions() {
  return (
    <footer className="td-quick-actions" aria-label="Primary workflow">
      <Button type="button" variant="outline">
        <Upload data-icon="inline-start" />
        导入旧简历
      </Button>
      <Button type="button" variant="outline">
        <LayoutTemplate data-icon="inline-start" />
        从模板开始
      </Button>
      <Button type="button" variant="outline">
        <FileText data-icon="inline-start" />
        粘贴目标 JD
      </Button>
      <Button type="button" variant="outline">
        <PanelRightOpen data-icon="inline-start" />
        添加资料库材料
      </Button>
      <Button type="button" variant="outline">
        <Moon data-icon="inline-start" />
        查看本地权限
      </Button>
    </footer>
  )
}
