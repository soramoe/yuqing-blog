import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export function getPostPublishedAt(post: BlogPost): Date {
  return post.data.publishedAt ?? post.data.pubDate;
}

export async function getPublishedPosts(): Promise<BlogPost[]> {
  const posts = await getCollection(
    "blog",
    ({ data }) => import.meta.env.DEV || !data.draft,
  );

  return posts.sort((a, b) => {
    const dateDifference =
      getPostPublishedAt(b).valueOf() - getPostPublishedAt(a).valueOf();
    return dateDifference || a.id.localeCompare(b.id);
  });
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function getReadingTime(body?: string): number {
  const content = (body ?? "").replace(/\s+/g, "");
  return Math.max(1, Math.ceil(content.length / 400));
}
