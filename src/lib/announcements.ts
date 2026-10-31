export type AnnouncementType =
  | "info"
  | "success"
  | "warning"
  | "maintenance";

export type AnnouncementPlacement = "site" | "points" | "shop";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: AnnouncementType;
  placement: AnnouncementPlacement;
  linkUrl: string | null;
  linkText: string | null;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  updatedAt: number;
}
