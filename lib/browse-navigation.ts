// Reveal the start of a result set only when it is obscured or off-screen.
export function resultsScrollTarget(
  resultsTop: number,
  headerBottom: number,
  viewportHeight: number,
  pageScroll: number,
) {
  const inset = headerBottom + 24;
  if (resultsTop >= headerBottom && resultsTop < viewportHeight - 80)
    return null;
  return Math.max(0, pageScroll + resultsTop - inset);
}
