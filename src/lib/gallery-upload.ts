import { SITE } from "../site.config";

export const GALLERY_UPLOAD_WIDTHS = [480, 960, 1920] as const;
export const GALLERY_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type GalleryUploadStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "deleted";

export interface OnlineGalleryItem {
  id: string;
  title: string;
  width: number;
  height: number;
  source: "admin" | "public";
  status: GalleryUploadStatus;
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

export function toOnlineGalleryItem(row: {
  id: string;
  title: string;
  baseName: string;
  width: number;
  height: number;
  source: "admin" | "public";
  status: GalleryUploadStatus;
  createdAt: number;
}): OnlineGalleryItem {
  const urls = galleryVariantUrls(row.baseName);
  return {
    id: row.id,
    title: row.title,
    width: row.width,
    height: row.height,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
    src: urls[960],
    srcSet: `${urls[480]} 480w, ${urls[960]} 960w, ${urls[1920]} 1920w`,
    href: urls[1920],
  };
}
