import { RouterProvider } from "react-router-dom"
import { Toaster } from "sonner"
import { router } from "./router"
import "./styles.css"

export function App() {
  return (
    <>
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
