import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const groups = [
  {
    source: path.join(process.cwd(), "public", "gallery"),
    output: path.join(process.cwd(), "public", "media", "optimized", "gallery"),
    widths: [480, 960],
  },
  {
    source: path.join(process.cwd(), "public", "covers"),
    output: path.join(process.cwd(), "public", "media", "optimized", "covers"),
    widths: [480, 960, 1440],
  },
];

let generated = 0;
let skipped = 0;

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

console.log(`Optimized images: ${generated} generated, ${skipped} cached.`);
