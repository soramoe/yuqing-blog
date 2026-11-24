import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export function getPostPublishedAt(post: BlogPost): Date {
  return post.data.publishedAt;
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

/** 统计全站标签出现次数，越常见说明信息量越低。 */
export function getTagUsage(posts: BlogPost[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      usage.set(tag, (usage.get(tag) ?? 0) + 1);
    }
  }
  return usage;
}

// 频次只需要算一次，模块级缓存让同一进程里的所有卡片共用。
let siteTagUsage: Promise<Map<string, number>> | undefined;

export function getSiteTagUsage(): Promise<Map<string, number>> {
  return (siteTagUsage ??= getPublishedPosts().then(getTagUsage));
}

/**
 * 卡片标签按信息量排序：越少见的标签越靠前，全站通用标签（Astro、Cloudflare）
 * 排到最后，交给样式里「最多两排」的截断隐藏。原顺序作为同频次时的次序。
 */
export function rankTagsForCard(
  tags: string[],
  usage: Map<string, number>,
): string[] {
  return tags
    .map((tag, index) => ({ tag, index, weight: usage.get(tag) ?? 0 }))
    .sort((a, b) => a.weight - b.weight || a.index - b.index)
    .map((item) => item.tag);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function getReadingTime(body?: string): number {
  const content = (body ?? "").replace(/\s+/g, "");
  return Math.max(1, Math.ceil(content.length / 400));
}
