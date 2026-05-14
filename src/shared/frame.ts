/** True if a step recorded in frame `stepFrameUrl` should run in the current frame `currentUrl`. */
export function frameMatches(stepFrameUrl: string | undefined, currentUrl: string): boolean {
  if (!stepFrameUrl) return true;
  try {
    const a = new URL(stepFrameUrl);
    const b = new URL(currentUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return stepFrameUrl === currentUrl;
  }
}
