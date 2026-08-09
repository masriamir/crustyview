/** Short git SHA of this build, injected by Vite (`__BUILD_SHA__`). */
export const BUILD_SHA: string = __BUILD_SHA__;

/**
 * The status-bar build string. The SHA matters because between release PRs the
 * manifest version is the *last released* one, so a bare version would name the
 * wrong build — but when the SHA is unavailable, showing the version alone beats
 * showing the word "unknown".
 */
export function formatBuild(version: string, sha: string): string {
  return sha && sha !== 'unknown' ? `v${version} · ${sha}` : `v${version}`;
}
