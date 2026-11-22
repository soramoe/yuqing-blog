export const COMMENT_MAX_LENGTH = 1200;
export const COMMENT_PAGE_SIZE = 20;

export interface CommentApiItem {
  id: string;
  body: string;
  createdAt: number;
  parentId: string | null;
  replyToName: string | null;
  canDelete: boolean;
  user: {
    name: string;
    image: string | null;
  };
}

export interface CommentApiResponse {
  comments: CommentApiItem[];
  nextCursor: string | null;
  total: number;
}

export function normalizeCommentBody(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
}

export function isPostSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{0,159}$/i.test(value)
  );
}

export function isCommentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)
  );
}
