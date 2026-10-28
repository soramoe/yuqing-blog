import galleryManifest from "../data/gallery.json";

export interface GalleryImage {
  title: string;
  cover: string;
  width: number;
  height: number;
  sortKey: string;
}

export const galleryImages: GalleryImage[] = galleryManifest
  .map((image) => {
    const dateMatch = image.file.match(/^(\d{4})(\d{2})(\d{2})_/);
    const date = dateMatch
      ? `${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}`
      : null;

    return {
      title: date ? `渔图 · ${date}` : "渔图",
      cover: `/gallery/${image.file}`,
      width: image.width,
      height: image.height,
      sortKey: dateMatch
        ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
        : "0000-00-00",
    };
  })
  .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
