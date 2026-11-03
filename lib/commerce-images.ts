// Same buckets as the customer app's shopify_image_url.dart. Let the browser
// select for the rendered slot and device pixel ratio, without cropping.
export const imageWidths = [200, 400, 800, 1200, 1600, 2048] as const;
export function adjacentGalleryImages(images: string[], index: number) {
  if (images.length < 2) return [];
  return [
    ...new Set(
      [1, 2, -1].map(
        (offset) => images[(index + offset + images.length) % images.length],
      ),
    ),
  ].filter((src) => src !== images[index]);
}
export const imageSizes = {
  product:
    "(max-width: 760px) 46vw, (max-width: 1099px) 23vw, (max-width: 1439px) 20vw, 17vw",
  shop: "(max-width: 760px) 92vw, (max-width: 1099px) 31vw, (max-width: 1439px) 39vw, 26vw",
  gallery: "(max-width: 760px) 94vw, (max-width: 1099px) 48vw, 540px",
  thumbnail: "64px",
  logo: "56px",
} as const;
export function sizedImageUrl(src: string, width: number): string {
  try {
    const url = new URL(src);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "cdn.shopify.com" ||
      /\.svg$/i.test(url.pathname)
    )
      return src;
    url.searchParams.set("width", String(width));
    url.searchParams.delete("height");
    return url.href;
  } catch {
    return src;
  }
}
export function responsiveImage(src: string, size: keyof typeof imageSizes) {
  const width =
    size === "thumbnail" || size === "logo"
      ? 200
      : size === "gallery"
        ? 800
        : 400;
  const resized = sizedImageUrl(src, width);
  return {
    src: resized,
    ...(resized !== src
      ? {
          srcSet: imageWidths
            .map((w) => `${sizedImageUrl(src, w)} ${w}w`)
            .join(", "),
          sizes: imageSizes[size],
        }
      : {}),
  };
}
