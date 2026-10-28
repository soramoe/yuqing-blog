export type CommentStatus = "visible" | "hidden" | "deleted";
export type CommentStatusFilter = CommentStatus | "all";

export interface AdminCommentItem {
  id: string;
  postSlug: string;
  body: string;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
  user: {
    name: string;
    image: string | null;
  };
}

export interface AdminCommentsResponse {
  comments: AdminCommentItem[];
  nextCursor: string | null;
  total: number;
}

export function isCommentAdmin(
  configuredIds: string | undefined,
  userId: string,
) {
  const allowed = new Set(
    (configuredIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowed.has(userId);
}

export function escapeLike(value: string) {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}
