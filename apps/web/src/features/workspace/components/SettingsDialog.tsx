import { Languages, Moon, ShieldCheck, SlidersHorizontal, Sun } from "lucide-react"
import type { ReactNode } from "react"
import type { ThemePreference, UiLanguage, WorkspaceCopy } from "../types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

type SettingsDialogProps = {
  children: ReactNode
  copy: WorkspaceCopy
  uiLanguage: UiLanguage
  themePreference: ThemePreference
  onUiLanguageChange: (language: UiLanguage) => void
  onThemePreferenceChange: (theme: ThemePreference) => void
}

const sections = [
  { label: "Appearance", icon: SlidersHorizontal },
  { label: "Language", icon: Languages },
  { label: "Privacy", icon: ShieldCheck },
]

export function SettingsDialog({
  children,
  copy,
  uiLanguage,
  themePreference,
  onUiLanguageChange,
  onThemePreferenceChange,
}: SettingsDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-[880px] gap-0 overflow-hidden p-0 sm:max-w-[880px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{copy.settings}</DialogTitle>
          <DialogDescription>Configure TypeDance without leaving the resume workspace.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[420px] grid-cols-[220px_minmax(0,1fr)] max-sm:grid-cols-1">
          <aside className="border-r bg-muted/40 p-3 max-sm:border-b max-sm:border-r-0">
            <div className="flex flex-col gap-1">
              {sections.map((section, index) => {
                const Icon = section.icon
                return (
                  <Button
                    key={section.label}
                    variant={index === 0 ? "secondary" : "ghost"}
                    className="justify-start"
                    type="button"
                  >
                    <Icon data-icon="inline-start" />
                    {section.label}
                  </Button>
                )
              })}
            </div>
          </aside>

          <section className="flex flex-col gap-6 p-5">
            <div className="grid gap-2">
              <h3 className="text-base font-semibold">Appearance</h3>
              <p className="text-sm text-muted-foreground">
                Theme and interface language live here so the editor toolbar can stay focused on document work.
              </p>
            </div>

            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Sun /> {copy.theme}
                </span>
                <Select value={themePreference} onValueChange={(value) => onThemePreferenceChange(value as ThemePreference)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Languages /> {copy.language}
                </span>
                <Select value={uiLanguage} onValueChange={(value) => onUiLanguageChange(value as UiLanguage)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="zh-CN">中文</SelectItem>
                      <SelectItem value="en-US">English</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <Separator />

            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-start gap-3">
                <Moon className="mt-0.5" />
                <div className="grid gap-1">
                  <strong className="text-sm">Resume language stays independent</strong>
                  <p className="text-sm text-muted-foreground">
                    UI language changes labels only. Resume target language still belongs to the active resume version.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
