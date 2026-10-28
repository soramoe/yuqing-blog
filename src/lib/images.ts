import { SITE } from "../site.config";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const mediaBaseUrl = SITE.mediaBaseUrl.replace(/\/+$/, "");

export interface ResponsiveImage {
  src: string;
  srcSet: string;
  variants: string[];
}

export function getResponsiveImage(
  source: string,
  widths: readonly number[],
): ResponsiveImage {
  const normalized = source.replace(/^\/+/, "");
  const extension = normalized.match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";

  if (!imageExtensions.has(extension)) {
    return { src: source, srcSet: "", variants: [source] };
  }

  const pathWithoutExtension = normalized.slice(0, -extension.length);
  const variants = widths.map(
    (width) => `${mediaBaseUrl}/${pathWithoutExtension}-${width}.webp`,
  );
  const fallbackIndex = Math.min(1, variants.length - 1);

  return {
    src: variants[fallbackIndex] ?? source,
    srcSet: variants
      .map((variant, index) => `${variant} ${widths[index]}w`)
      .join(", "),
    variants,
  };
}
