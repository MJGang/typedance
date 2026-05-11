import type { ClassValidationIssue, PdfClassPolicy } from "./types"

export function splitClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function validateTemplateClasses(
  className: string,
  policy: PdfClassPolicy,
): ClassValidationIssue[] {
  const allowlist = new Set(policy.allowlist)
  const blocklist = new Set(policy.blocklist)

  for (const group of Object.values(policy.groups)) {
    for (const item of group.allowlist) {
      allowlist.add(item)
    }
    for (const item of group.blocklist ?? []) {
      blocklist.add(item)
    }
  }

  return splitClasses(className).flatMap((item) => {
    if (blocklist.has(item)) {
      return [{ className: item, reason: "blocked" as const }]
    }

    if (!allowlist.has(item)) {
      return [{ className: item, reason: "not_allowed" as const }]
    }

    return []
  })
}
