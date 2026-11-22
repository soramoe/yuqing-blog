import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({
    base: "./src/content/blog",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    publishedAt: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    cover: z.string().optional(),
    hideCover: z.boolean().default(false),
  }),
});

const toolFeature = z.object({
  icon: z.enum(["chat", "music", "support", "report", "obs", "pk"]),
  title: z.string(),
  description: z.string(),
});

const toolStep = z.object({
  title: z.string(),
  description: z.string(),
});

const toolFaq = z.object({
  question: z.string(),
  answer: z.string(),
});

const toolScreenshot = z.object({
  src: z.string().startsWith("/"),
  alt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const tools = defineCollection({
  loader: glob({
    base: "./src/content/tools",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({
    name: z.string(),
    title: z.string(),
    description: z.string(),
    summary: z.string(),
    eyebrow: z.string().default("DESKTOP TOOL"),
    version: z.string(),
    releasedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    status: z.enum(["available", "coming-soon", "retired"]).default("available"),
    platforms: z.array(z.string()).min(1),
    packageName: z.string(),
    sizeBytes: z.number().int().positive(),
    packageCount: z.number().int().positive().optional(),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((value) => value.toUpperCase()),
    downloadUrl: z.string().url(),
    releaseUrl: z.string().url(),
    manualUrl: z.string(),
    repoUrl: z.string().url().optional(),
    licenseUrl: z.string().url().optional(),
    feedbackGroup: z.string().optional(),
    features: z.array(toolFeature).default([]),
    steps: z.array(toolStep).default([]),
    requirements: z.array(z.string()).default([]),
    faqs: z.array(toolFaq).default([]),
    screenshots: z.array(toolScreenshot).default([]),
    trialDays: z.number().int().positive().optional(),
    priceNote: z.string().optional(),
    licenseNotes: z.array(z.string()).default([]),
    footerNote: z.string().optional(),
    coverImage: z.string().startsWith("/").optional(),
    draft: z.boolean().default(false),
    order: z.number().int().default(100),
  }),
});

export const collections = { blog, tools };
