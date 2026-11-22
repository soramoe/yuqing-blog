export type AnnouncementType =
  | "info"
  | "success"
  | "warning"
  | "maintenance";

export type AnnouncementPlacement = "site" | "points" | "shop" | "custom";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: AnnouncementType;
  placement: AnnouncementPlacement;
  priority: number;
  targetPath: string | null;
  linkUrl: string | null;
  linkText: string | null;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AnnouncementArchiveItem extends Announcement {
  expired: boolean;
}

export function normalizeAnnouncementPath(value: string) {
  const path = value.trim().split(/[?#]/, 1)[0];
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 200) {
    return null;
  }
  if (path === "/") return "/";
  return path.endsWith("/") ? path : `${path}/`;
}

export function announcementMatchesPath(
  announcement: Announcement,
  currentPath: string,
) {
  if (announcement.targetPath) {
    return (
      currentPath === announcement.targetPath ||
      (announcement.targetPath.endsWith("/") &&
        currentPath.startsWith(announcement.targetPath))
    );
  }
  if (announcement.placement === "site") return true;
  if (announcement.placement === "points") {
    return currentPath.startsWith("/points/");
  }
  if (announcement.placement === "shop") {
    return currentPath.startsWith("/shop/");
  }
  return false;
}
