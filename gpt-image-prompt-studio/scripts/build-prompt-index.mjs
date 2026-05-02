import { readFile, writeFile } from "node:fs/promises";

const promptsPath = new URL("../public/data/prompts.json", import.meta.url);
const indexPath = new URL("../public/data/prompts-index.json", import.meta.url);

const prompts = JSON.parse(await readFile(promptsPath, "utf8"));
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

const index = prompts.map((prompt) => ({
  id: prompt.id,
  title: prompt.title,
  description: prompt.description,
  language: prompt.language,
  featured: prompt.featured,
  coverImage: toCachedImageUrl(prompt.coverImage),
}));

await writeFile(indexPath, JSON.stringify(index));
console.log(`Wrote ${index.length} prompt index items to ${indexPath.pathname}`);
