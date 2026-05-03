import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const promptsPath = new URL("../public/data/prompts.json", import.meta.url);
const imageCacheDir = fileURLToPath(new URL("../public/image-cache", import.meta.url));
const imageThumbsDir = fileURLToPath(new URL("../public/image-thumbs", import.meta.url));
const cachedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function toYouMindThumbPath(url) {
  try {
    const imageUrl = new URL(url);
    if (imageUrl.hostname !== "cms-assets.youmind.com") return "";
    const hash = createHash("sha1").update(imageUrl.href).digest("hex");
    return {
      hash,
      publicPath: `/image-thumbs/${hash}.webp`,
    };
  } catch {
    return "";
  }
}

async function findCachedImage(hash) {
  for (const extension of cachedExtensions) {
    const filePath = join(imageCacheDir, `${hash}${extension}`);
    if (existsSync(filePath)) return filePath;
  }

  return "";
}

async function buildThumbnail(sourcePath, targetPath) {
  await sharp(sourcePath)
    .rotate()
    .resize({
      width: 360,
      height: 360,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 45 })
    .toFile(targetPath);
}

const prompts = JSON.parse(await readFile(promptsPath, "utf8"));
await mkdir(imageThumbsDir, { recursive: true });

let withCover = 0;
let generated = 0;
let reused = 0;
let missing = 0;
let failed = 0;

for (const prompt of prompts) {
  const thumbInfo = toYouMindThumbPath(prompt.coverImage);
  if (!thumbInfo) continue;

  withCover += 1;
  const targetPath = join(imageThumbsDir, `${thumbInfo.hash}.webp`);
  const cachedImagePath = await findCachedImage(thumbInfo.hash);

  if (!cachedImagePath) {
    missing += 1;
    delete prompt.thumbnailImage;
    continue;
  }

  if (existsSync(targetPath)) {
    reused += 1;
    prompt.thumbnailImage = thumbInfo.publicPath;
    continue;
  }

  try {
    await buildThumbnail(cachedImagePath, targetPath);
    prompt.thumbnailImage = thumbInfo.publicPath;
    generated += 1;
  } catch {
    failed += 1;
    delete prompt.thumbnailImage;
  }
}

await writeFile(promptsPath, `${JSON.stringify(prompts)}\n`);

const totalThumbs = existsSync(imageThumbsDir) ? (await readdir(imageThumbsDir)).length : 0;
console.log(
  `YouMind thumbnails: ${generated} generated, ${reused} reused, ${missing} missing cache, ${failed} failed, ${withCover} cover images, ${totalThumbs} files in ${imageThumbsDir.replace(projectRoot, "")}`,
);
