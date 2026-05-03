import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const promptsPath = new URL("../public/data/prompts.json", import.meta.url);
const indexPath = new URL("../public/data/prompts-index.json", import.meta.url);

const prompts = JSON.parse(await readFile(promptsPath, "utf8"));

function toYouMindThumbnailUrl(url) {
  if (!url) return "";

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "cms-assets.youmind.com") {
      const hash = createHash("sha1").update(parsedUrl.href).digest("hex");
      return `/api/image-thumb?url=${encodeURIComponent(url)}&id=${hash}`;
    }
  } catch {
    return "";
  }

  return "";
}

function toCachedImageUrl(url) {
  if (!url) return "";

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "cms-assets.youmind.com") {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }

  return url;
}

function toSearchText(prompt) {
  return [
    prompt.title,
    prompt.description,
    prompt.language,
    prompt.sourcePlatform,
    prompt.authorName,
    prompt.searchText?.slice(0, 520),
  ]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .slice(0, 720);
}

const index = prompts.map((prompt) => ({
  id: prompt.id,
  title: prompt.title,
  description: prompt.description,
  language: prompt.language,
  featured: prompt.featured,
  coverImage: toCachedImageUrl(prompt.coverImage),
  thumbnailImage: toCachedImageUrl(prompt.thumbnailImage) || toYouMindThumbnailUrl(prompt.coverImage),
  searchText: toSearchText(prompt),
}));

await writeFile(indexPath, JSON.stringify(index));
console.log(`Wrote ${index.length} prompt index items to ${indexPath.pathname}`);
