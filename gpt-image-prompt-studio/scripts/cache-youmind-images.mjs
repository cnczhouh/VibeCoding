import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const promptsPath = new URL("../public/data/prompts.json", import.meta.url);
const imageCacheDir = fileURLToPath(new URL("../public/image-cache", import.meta.url));
const imageThumbsDir = fileURLToPath(new URL("../public/image-thumbs", import.meta.url));
const reportPath = new URL("../public/data/youmind-image-cache-report.json", import.meta.url);
const cachedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const concurrency = Number(process.env.YOUMIND_IMAGE_CONCURRENCY || 6);
const execFileAsync = promisify(execFile);

function normalizeYouMindUrl(value) {
  if (!value || typeof value !== "string") return "";

  try {
    const url = new URL(value);
    if (url.hostname !== "cms-assets.youmind.com") return "";
    return url.href;
  } catch {
    return "";
  }
}

function getImageExtension(url, contentType = "") {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes("png")) return ".png";
  if (normalizedType.includes("webp")) return ".webp";
  if (normalizedType.includes("gif")) return ".gif";

  try {
    const pathExtension = extname(new URL(url).pathname).toLowerCase();
    if (cachedExtensions.includes(pathExtension)) return pathExtension;
  } catch {
    // Fall through to jpeg.
  }

  return ".jpg";
}

function toImageMeta(url) {
  const hash = createHash("sha1").update(url).digest("hex");
  return {
    hash,
    originalPath: "",
    publicThumbPath: `/image-thumbs/${hash}.webp`,
    thumbPath: join(imageThumbsDir, `${hash}.webp`),
    url,
  };
}

async function findCachedImage(hash) {
  for (const extension of cachedExtensions) {
    const filePath = join(imageCacheDir, `${hash}${extension}`);
    if (existsSync(filePath)) return filePath;
  }

  return "";
}

async function downloadWithFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadWithPowerShell(url, filePath) {
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:IMAGE_URL -OutFile $env:IMAGE_FILE -TimeoutSec 60 -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept'='image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }",
    ],
    {
      env: {
        ...process.env,
        IMAGE_URL: url,
        IMAGE_FILE: filePath,
      },
      timeout: 75_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
}

async function downloadImage(meta) {
  const cachedPath = await findCachedImage(meta.hash);
  if (cachedPath) {
    meta.originalPath = cachedPath;
    return "cached";
  }

  try {
    const downloaded = await downloadWithFetch(meta.url);
    const targetPath = join(imageCacheDir, `${meta.hash}${getImageExtension(meta.url, downloaded.contentType)}`);
    await writeFile(targetPath, downloaded.buffer);
    meta.originalPath = targetPath;
    return "downloaded";
  } catch {
    const fallbackTargetPath = join(imageCacheDir, `${meta.hash}${getImageExtension(meta.url)}`);
    await downloadWithPowerShell(meta.url, fallbackTargetPath);
    meta.originalPath = fallbackTargetPath;
    return "downloaded";
  }
}

async function buildThumbnail(meta) {
  if (!meta.originalPath) return "missing-original";
  if (existsSync(meta.thumbPath)) return "cached";

  await sharp(meta.originalPath)
    .rotate()
    .resize({
      width: 360,
      height: 360,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 45 })
    .toFile(meta.thumbPath);

  return "generated";
}

function collectImageUrls(prompts) {
  const urls = new Set();

  for (const prompt of prompts) {
    const coverUrl = normalizeYouMindUrl(prompt.coverImage);
    if (coverUrl) urls.add(coverUrl);

    if (Array.isArray(prompt.images)) {
      for (const image of prompt.images) {
        const imageUrl = normalizeYouMindUrl(image);
        if (imageUrl) urls.add(imageUrl);
      }
    }
  }

  return Array.from(urls);
}

function updatePromptImagePaths(prompts, metaByUrl) {
  for (const prompt of prompts) {
    const coverMeta = metaByUrl.get(normalizeYouMindUrl(prompt.coverImage));
    if (coverMeta?.originalPath) {
      prompt.thumbnailImage = coverMeta.publicThumbPath;
    }
  }
}

async function runQueue(items, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(workers);
}

const prompts = JSON.parse(await readFile(promptsPath, "utf8"));
const urls = collectImageUrls(prompts);
const metas = urls.map(toImageMeta);
const metaByUrl = new Map(metas.map((meta) => [meta.url, meta]));

await mkdir(imageCacheDir, { recursive: true });
await mkdir(imageThumbsDir, { recursive: true });

const stats = {
  total: metas.length,
  alreadyCached: 0,
  downloaded: 0,
  downloadFailed: 0,
  thumbnailCached: 0,
  thumbnailGenerated: 0,
  thumbnailFailed: 0,
};
const failures = [];
const startedAt = new Date().toISOString();

await runQueue(metas, async (meta, index) => {
  try {
    const downloadStatus = await downloadImage(meta);
    if (downloadStatus === "cached") stats.alreadyCached += 1;
    if (downloadStatus === "downloaded") stats.downloaded += 1;

    const thumbnailStatus = await buildThumbnail(meta);
    if (thumbnailStatus === "cached") stats.thumbnailCached += 1;
    if (thumbnailStatus === "generated") stats.thumbnailGenerated += 1;
  } catch (error) {
    stats.downloadFailed += meta.originalPath ? 0 : 1;
    stats.thumbnailFailed += meta.originalPath ? 1 : 0;
    failures.push({
      url: meta.url,
      hash: meta.hash,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const done = index + 1;
  if (done % 50 === 0 || done === metas.length) {
    console.log(
      `[${done}/${metas.length}] originals: ${stats.alreadyCached} cached, ${stats.downloaded} downloaded, ${stats.downloadFailed} failed; thumbs: ${stats.thumbnailCached} cached, ${stats.thumbnailGenerated} generated, ${stats.thumbnailFailed} failed`,
    );
  }
});

updatePromptImagePaths(prompts, metaByUrl);
await writeFile(promptsPath, `${JSON.stringify(prompts)}\n`);

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  stats,
  failures,
  cacheFiles: existsSync(imageCacheDir) ? (await readdir(imageCacheDir)).length : 0,
  thumbFiles: existsSync(imageThumbsDir) ? (await readdir(imageThumbsDir)).length : 0,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Image cache report written to ${fileURLToPath(reportPath)}`);
