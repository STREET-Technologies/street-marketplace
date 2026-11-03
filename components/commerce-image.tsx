"use client";
import { useState } from "react";
import { responsiveImage, type imageSizes } from "../lib/commerce-images";

export default function CommerceImage({
  src,
  alt = "",
  size = "product",
  eager = false,
  className,
}: {
  src: string | null;
  alt?: string;
  size?: keyof typeof imageSizes;
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    <img
      {...responsiveImage(src, size)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "auto"}
      onError={() => setFailed(src)}
    />
  ) : (
    <span className="image-unavailable">Image unavailable</span>
  );
}
