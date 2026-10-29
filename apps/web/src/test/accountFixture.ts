import type { AccountSession } from "../accountSession"

export function testAccountSession(id = "test-account"): AccountSession {
  return {
    id,
    sidecar_url: "http://127.0.0.1:4317",
    agent_host_url: "http://127.0.0.1:4327",
    token: `fixture-${id}-capability-01234567890123456789`,
  }
}

/** Tests explicitly publish their verified desktop fixture; production has no web identity bypass. */
export async function installTestAccountSession(id = "test-account") {
  const { setAccountSession } = await import("../accountSession")
  setAccountSession(null)
  setAccountSession(testAccountSession(id))
}
