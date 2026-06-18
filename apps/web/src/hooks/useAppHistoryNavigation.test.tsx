import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BrowserRouter, Link, useLocation } from "react-router-dom"
import { useAppHistoryNavigation } from "./useAppHistoryNavigation"

function Probe() {
  const location = useLocation()
  const navigation = useAppHistoryNavigation()

  return (
    <>
      <span data-testid="pathname">{location.pathname}</span>
      <button type="button" onClick={navigation.goBack} disabled={!navigation.canGoBack}>返回</button>
      <button type="button" onClick={navigation.goForward} disabled={!navigation.canGoForward}>前进</button>
      <Link to="/next">下一页</Link>
      <Link to="/replacement">替代页</Link>
    </>
  )
}

describe("useAppHistoryNavigation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/")
  })

  afterEach(() => {
    cleanup()
  })

  it("keeps navigation inside the current application session", async () => {
    render(<BrowserRouter><Probe /></BrowserRouter>)

    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "前进" })).toBeDisabled()

    fireEvent.click(screen.getByRole("link", { name: "下一页" }))
    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/next"))
    expect(screen.getByRole("button", { name: "返回" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "前进" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "返回" }))
    await waitFor(() => expect(screen.getByTestId("pathname").textContent).toBe("/"))
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "前进" })).toBeEnabled()

    fireEvent.click(screen.getByRole("link", { name: "替代页" }))
    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/replacement"))
    expect(screen.getByRole("button", { name: "返回" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "前进" })).toBeDisabled()
  })
})
