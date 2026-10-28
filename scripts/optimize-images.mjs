import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const sourceRoot = path.join(process.cwd(), "media-src");
const outputRoot = path.join(process.cwd(), "media-upload");
const groups = [
  {
    name: "gallery",
    source: path.join(sourceRoot, "gallery"),
    output: path.join(outputRoot, "gallery"),
    widths: [480, 960, 1920],
  },
  {
    name: "covers",
    source: path.join(sourceRoot, "covers"),
    output: path.join(outputRoot, "covers"),
    widths: [480, 960, 1440],
  },
];

let generated = 0;
let skipped = 0;
const galleryManifest = [];

for (const group of groups) {
  await mkdir(group.output, { recursive: true });
  const entries = await readdir(group.source, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const sourcePath = path.join(group.source, entry.name);
    const sourceStat = await stat(sourcePath);
    const baseName = path.basename(entry.name, path.extname(entry.name));

    if (group.name === "gallery") {
      const metadata = await sharp(sourcePath, { failOn: "none" }).metadata();
      galleryManifest.push({
        file: entry.name,
        width: metadata.width,
        height: metadata.height,
      });
    }

    for (const width of group.widths) {
      const outputPath = path.join(group.output, `${baseName}-${width}.webp`);
      const cached = await stat(outputPath).catch(() => null);

      if (cached && cached.mtimeMs >= sourceStat.mtimeMs) {
        skipped += 1;
        continue;
      }

      await sharp(sourcePath, { failOn: "none" })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78, effort: 5, smartSubsample: true })
        .toFile(outputPath);
      generated += 1;
    }
  }
}

await writeFile(
  path.join(process.cwd(), "src", "data", "gallery.json"),
  `${JSON.stringify(galleryManifest, null, 2)}\n`,
);

console.log(`Optimized images: ${generated} generated, ${skipped} cached.`);
