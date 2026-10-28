const forbiddenReleasePatterns = [
  /(^|[/\\])\.env(?:\.|$)/i,
  /(?:^|[/\\])langfuse\.env$/i,
  /\.(?:pem|pfx|p12|key)$/i,
  /(?:^|[/\\])typedance\.sqlite$/i,
  /(?:^|[/\\])\.git(?:[/\\]|$)/i,
]

export function assertReleaseVersions(versions) {
  const entries = Object.entries(versions)
  const expected = entries[0]?.[1]
  const mismatch = entries.find(([, value]) => value !== expected)
  if (!expected || mismatch) {
    throw new Error(
      `Release versions must match: ${entries.map(([name, value]) => `${name}=${value}`).join(", ")}`,
    )
  }
  return expected
}

export function findForbiddenReleasePaths(paths) {
  return paths.filter((path) => forbiddenReleasePatterns.some((pattern) => pattern.test(path)))
}

export function releaseArtifactNames(version) {
  const installer = `TypeDance_${version}_x64-setup.exe`
  return [installer, `${installer}.sha256`, `${installer}.sig`, "latest.json"]
}

export function createUpdateManifest({ version, signature, notes, publishedAt, repository }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository ?? "")) {
    throw new Error("A public update repository in owner/repo format is required")
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Invalid update version")
  }
  const signed = signature.trim()
  if (!signed || !/^[A-Za-z0-9+/]+={0,2}$/.test(signed)) {
    throw new Error("Missing or invalid updater signature")
  }
  if (Number.isNaN(Date.parse(publishedAt))) throw new Error("Invalid update publication date")
  return {
    version,
    notes: notes.trim(),
    pub_date: new Date(publishedAt).toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: signed,
        url: `https://github.com/${repository}/releases/download/v${version}/TypeDance_${version}_x64-setup.exe`,
      },
    },
  }
}
