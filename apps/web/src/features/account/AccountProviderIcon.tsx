import { Github } from "lucide-react"
import type { AccountProvider } from "@/accountState"

export function AccountProviderIcon({ provider }: { provider: AccountProvider }) {
  if (provider === "github") return <Github data-icon="inline-start" aria-hidden="true" />
  return <img src={`/images/auth/${provider}.svg`} alt="" aria-hidden="true" data-icon="inline-start" className="size-4 shrink-0" />
}
