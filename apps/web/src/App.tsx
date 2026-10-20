import { RouterProvider } from "react-router-dom"
import { Toaster } from "sonner"
import { router } from "./router"
import { ClientUpdateStartup } from "./features/settings/useClientUpdater"
import "./styles.css"

export function App() {
  return (
    <>
      <ClientUpdateStartup />
      <RouterProvider router={router} />
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
