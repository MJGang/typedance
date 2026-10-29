import { useSyncExternalStore } from "react"
import { getAccountView, subscribeAccountView } from "@/accountState"

export function useAccount() {
  return useSyncExternalStore(subscribeAccountView, getAccountView)
}
