import { useEffect, useState } from "react"
import { RouterProvider } from "react-router-dom"
import { Toaster } from "sonner"
import { createAppRouter } from "./router"
import { ClientUpdateStartup } from "./features/settings/useClientUpdater"
import { AccountGate } from "./features/account/AccountGate"
import "./styles.css"

function AccountWorkspace() {
  const [router, setRouter] = useState<ReturnType<typeof createAppRouter> | null>(null)
  useEffect(() => {
    // Account navigation is recreated with the business tree; the previous document stays private.
    window.history.replaceState(null, "", "/")
    const accountRouter = createAppRouter()
    setRouter(accountRouter)
    return () => accountRouter.dispose()
  }, [])
  return router ? <RouterProvider router={router} /> : null
}

export function App() {
  return (
    <>
      <ClientUpdateStartup />
      <AccountGate><AccountWorkspace /></AccountGate>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          duration: 5000,
        }}
      />
    </>
  )
}
