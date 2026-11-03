import { responsiveImage } from "../commerce-images.ts";

export function canPrefetch() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return (
    !connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType ?? "")
  );
}

export function preloadGalleryImage(src: string) {
  const image = new Image();
  const responsive = responsiveImage(src, "gallery");
  image.decoding = "async";
  image.fetchPriority = "low";
  // Match the displayed image's candidate selection, including high-DPI screens.
  if (responsive.sizes) image.sizes = responsive.sizes;
  if (responsive.srcSet) image.srcset = responsive.srcSet;
  image.src = responsive.src;
  void image.decode().catch(() => {
    // Speculative failures are retried by the visible image when selected.
  });
  return image;
}
