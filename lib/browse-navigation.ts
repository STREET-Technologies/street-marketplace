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

// Shared by catalogue filters and desktop customer-page sidebars.
export function revealBrowseContent(content: Element | null | undefined) {
  if (!matchMedia("(min-width: 1100px)").matches) return;
  const header = document.querySelector(".marketplace-header");
  if (!content || !header) return;
  const top = resultsScrollTarget(
    content.getBoundingClientRect().top,
    header.getBoundingClientRect().bottom,
    innerHeight,
    scrollY,
  );
  if (top !== null)
    window.scrollTo({
      top,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
}
