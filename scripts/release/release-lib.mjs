const forbiddenReleasePatterns = [
  /(^|[/\\])\.env(?:\.|$)/i,
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
  return [installer, `${installer}.sha256`]
}
