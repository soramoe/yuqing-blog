import { SITE } from "../site.config";

export const GALLERY_UPLOAD_WIDTHS = [480, 960, 1920] as const;
export const GALLERY_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type GalleryUploadStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "deleted";

export type GalleryVisibility = "public" | "private";

export interface OnlineGalleryItem {
  id: string;
  title: string;
  width: number;
  height: number;
  source: "admin" | "public";
  status: GalleryUploadStatus;
  visibility: GalleryVisibility;
  locked: boolean;
  createdAt: number;
  src: string;
  srcSet: string;
  href: string;
}

export interface AdminGalleryItem extends OnlineGalleryItem {
  baseName: string;
  uploaderName: string;
  uploaderType: "admin" | "user" | "anonymous";
  reviewedAt: number | null;
  reviewHref: string;
}

export interface OwnedGalleryItem extends OnlineGalleryItem {
  uploadDate: string;
  reviewHref: string;
}

export interface GalleryUploadQuotaInfo {
  authenticated: boolean;
  isAdmin: boolean;
  dailyLimit: number;
  used: number;
  remaining: number;
  requiresReview: boolean;
}

export interface StaticGalleryItem {
  key: string;
  title: string;
  src: string;
  kind: "gallery" | "cover";
}

export function galleryVariantUrls(baseName: string) {
  const base = `${SITE.mediaBaseUrl}/gallery/uploads/${baseName}`;
  return {
    480: `${base}-480.webp`,
    960: `${base}-960.webp`,
    1920: `${base}-1920.webp`,
  };
}

export function galleryOriginalKeys(baseName: string) {
  return GALLERY_UPLOAD_WIDTHS.map(
    (width) => `gallery/uploads/${baseName}-${width}.webp`,
  );
}

export function galleryPrivateKeys(baseName: string) {
  return GALLERY_UPLOAD_WIDTHS.map(
    (width) => `gallery/private/${baseName}-${width}.webp`,
  );
}

export function galleryPrivatePreviewKey(baseName: string) {
  return `gallery/private-previews/${baseName}-480.webp`;
}

export function privateGallerySourceUrl(id: string, variant = 960) {
  return `/api/gallery/source/${encodeURIComponent(id)}?variant=${variant}`;
}

export function toOnlineGalleryItem(
  row: {
  id: string;
  title: string;
  baseName: string;
  width: number;
  height: number;
  source: "admin" | "public";
  status: GalleryUploadStatus;
  visibility?: GalleryVisibility;
  hasPrivatePreview?: boolean;
  createdAt: number;
  },
  options: { revealPrivateTitle?: boolean } = {},
): OnlineGalleryItem {
  const urls = galleryVariantUrls(row.baseName);
  const visibility: GalleryVisibility =
    row.visibility === "private" ? "private" : "public";
  const locked = visibility === "private";
  const preview = row.hasPrivatePreview
    ? `${SITE.mediaBaseUrl}/${galleryPrivatePreviewKey(row.baseName)}`
    : "/private-locked.svg";
  return {
    id: row.id,
    title:
      locked && !options.revealPrivateTitle ? "私密图片" : row.title,
    width: row.width,
    height: row.height,
    source: row.source,
    status: row.status,
    visibility,
    locked,
    createdAt: row.createdAt,
    src: locked ? preview : urls[960],
    srcSet: locked
      ? preview
      : `${urls[480]} 480w, ${urls[960]} 960w, ${urls[1920]} 1920w`,
    href: locked ? "/account/" : urls[1920],
  };
}
