import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const defaultSourceRoot = path.resolve(projectRoot, "..", "awesome-gpt-image-2-API-and-Prompts");
const sourceRoot = path.resolve(process.argv[2] || defaultSourceRoot);
const dataDir = path.join(projectRoot, "public", "data");
const backupRoot = path.join(projectRoot, "public", "data-backups");
const targetImageRoot = path.join(projectRoot, "public", "evolink-images");
const targetThumbRoot = path.join(projectRoot, "public", "evolink-thumbs");
const sourceImageRoot = path.join(sourceRoot, "images");
const caseDir = path.join(sourceRoot, "cases");
const metadataPath = path.join(sourceRoot, "data", "ingested_tweets.json");
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const categoryLabels = {
  "Portrait & Photography Cases": "人像摄影",
  "Poster & Illustration Cases": "海报插画",
  "Character Design Cases": "角色设计",
  "UI & Social Media Mockup Cases": "UI 社媒",
  "Comparison & Community Examples": "社区案例",
  "E-commerce Cases": "电商产品",
  "Ad Creative Cases": "广告创意",
  portrait: "人像摄影",
  poster: "海报插画",
  ui: "UI 社媒",
};

const fileCategoryFallbacks = {
  "portrait_zh-CN.md": "Portrait & Photography Cases",
  "poster_zh-CN.md": "Poster & Illustration Cases",
  "character_zh-CN.md": "Character Design Cases",
  "ui_zh-CN.md": "UI & Social Media Mockup Cases",
  "comparison_zh-CN.md": "Comparison & Community Examples",
  "ecommerce_zh-CN.md": "E-commerce Cases",
  "ad-creative_zh-CN.md": "Ad Creative Cases",
};

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function normalizeUrlPath(...segments) {
  return `/${segments
    .flatMap((segment) => String(segment).split(/[\\/]+/))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")}`;
}

function clipText(value, length = 110) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length - 1)}...` : compact;
}

function detectLanguage(value) {
  const hangulCount = (value.match(/[\uac00-\ud7af]/g) || []).length;
  const kanaCount = (value.match(/[\u3040-\u30ff]/g) || []).length;
  const hanCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (value.match(/[A-Za-z]/g) || []).length;

  if (hangulCount > 8) return "ko";
  if (kanaCount > 8) return "ja";
  if (hanCount > Math.max(18, latinCount / 4)) return "zh";
  return "en";
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function listImageFiles(dir) {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await listImageFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function backupCurrentData() {
  if (!existsSync(dataDir)) return "";

  const backupDir = path.join(backupRoot, `before-evolink-${timestamp()}`);
  await mkdir(backupDir, { recursive: true });

  for (const fileName of ["prompts.json", "prompts-index.json", "manifest.json"]) {
    const sourcePath = path.join(dataDir, fileName);
    if (existsSync(sourcePath)) {
      await cp(sourcePath, path.join(backupDir, fileName));
    }
  }

  return backupDir;
}

function parseCases(fileName, markdown, metadataByUrl) {
  const sections = markdown.split(/^### Case\s+/m).slice(1);
  const fallbackCategory = fileCategoryFallbacks[fileName] || "Comparison & Community Examples";

  return sections.map((rawSection) => {
    const section = `### Case ${rawSection}`;
    const heading = section.match(
      /^### Case\s+(\d+):\s+\[([^\]]+)\]\(([^)]+)\)\s+\(by\s+\[([^\]]+)\]\(([^)]+)\)\)/,
    );

    if (!heading) {
      throw new Error(`Cannot parse case heading in ${fileName}`);
    }

    const [, caseNumber, title, sourceLink, authorName, authorLink] = heading;
    const promptAreaStart = section.indexOf("**提示词");
    const promptArea = promptAreaStart >= 0 ? section.slice(promptAreaStart) : section;
    const promptBlock = promptArea.match(/```[^\n]*\n([\s\S]*?)\n```/);

    if (!promptBlock?.[1]?.trim()) {
      throw new Error(`Cannot parse prompt for ${title}`);
    }

    const metadata = metadataByUrl.get(sourceLink) || {};
    const category = metadata.category || fallbackCategory;

    return {
      caseNumber: Number(caseNumber),
      title,
      sourceLink,
      authorName: authorName.replace(/^@/, ""),
      authorLink,
      category,
      categoryLabel: categoryLabels[category] || category,
      prompt: promptBlock[1].trim(),
      sourcePublishedAt: metadata.added_at,
      imageDir: metadata.image_dir,
      sourcePlatform: sourceLink.includes("x.com") || sourceLink.includes("twitter.com") ? "X" : "GitHub",
      fileName,
    };
  });
}

async function buildImageMap(cases) {
  const uniqueDirs = [...new Set(cases.map((item) => item.imageDir).filter(Boolean))];
  const imageMap = new Map();

  await mkdir(targetImageRoot, { recursive: true });
  await mkdir(targetThumbRoot, { recursive: true });

  for (const imageDir of uniqueDirs) {
    const sourceDir = path.join(sourceRoot, imageDir);
    const relativeDir = path.relative(sourceImageRoot, sourceDir);
    const targetDir = path.join(targetImageRoot, relativeDir);
    const targetThumbDir = path.join(targetThumbRoot, relativeDir);
    const sourceStat = await stat(sourceDir).catch(() => null);

    if (!sourceStat?.isDirectory()) {
      imageMap.set(imageDir, []);
      continue;
    }

    await mkdir(path.dirname(targetDir), { recursive: true });
    await mkdir(targetThumbDir, { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true, force: true });

    const sourceFiles = await listImageFiles(sourceDir);
    const sortedFiles = sourceFiles
      .map((filePath) => path.relative(sourceDir, filePath))
      .sort((a, b) => {
        const aOutput = /(^|[\\/])output\./i.test(a);
        const bOutput = /(^|[\\/])output\./i.test(b);
        return Number(bOutput) - Number(aOutput) || a.localeCompare(b);
      });
    const urls = sortedFiles.map((filePath) => normalizeUrlPath("evolink-images", relativeDir, filePath));
    const thumbnails = [];

    for (const filePath of sortedFiles) {
      const sourceFilePath = path.join(sourceDir, filePath);
      const thumbRelativePath = filePath.replace(/\.[^.]+$/, ".webp");
      const targetThumbPath = path.join(targetThumbDir, thumbRelativePath);

      try {
        await mkdir(path.dirname(targetThumbPath), { recursive: true });
        await sharp(sourceFilePath, { animated: false })
          .rotate()
          .resize({
            width: 360,
            height: 360,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 45, effort: 5 })
          .toFile(targetThumbPath);

        thumbnails.push(normalizeUrlPath("evolink-thumbs", relativeDir, thumbRelativePath));
      } catch (error) {
        console.warn(`Could not create thumbnail for ${sourceFilePath}: ${error instanceof Error ? error.message : error}`);
        thumbnails.push("");
      }
    }

    imageMap.set(imageDir, { images: urls, thumbnails });
  }

  return imageMap;
}

function toPromptItems(cases, imageMap) {
  return cases.map((item, index) => {
    const imageData = imageMap.get(item.imageDir) || { images: [], thumbnails: [] };
    const images = imageData.images;
    const thumbnails = imageData.thumbnails;
    const description = `${item.categoryLabel}案例 / @${item.authorName} / ${clipText(item.prompt, 80)}`;
    const prompt = item.prompt;

    return {
      id: 800000 + index + 1,
      title: item.title,
      description,
      prompt,
      originalPrompt: prompt,
      language: detectLanguage(prompt),
      slug: slugify(`${item.categoryLabel}-${item.title}`),
      url: item.sourceLink,
      sourceLink: item.sourceLink,
      sourcePublishedAt: item.sourcePublishedAt,
      sourcePlatform: item.sourcePlatform,
      authorName: item.authorName,
      authorLink: item.authorLink,
      coverImage: images[0] || "",
      thumbnailImage: thumbnails[0] || "",
      images,
      featured: index < 28,
      needReferenceImages: /\b(reference|input|uploaded|photo of|your image)\b/i.test(prompt),
      searchText: [
        item.title,
        item.category,
        item.categoryLabel,
        item.authorName,
        prompt,
        item.fileName.replace("_zh-CN.md", ""),
      ].join("\n"),
    };
  });
}

function buildIndex(prompts) {
  return prompts.map((prompt) => ({
    id: prompt.id,
    title: prompt.title,
    description: prompt.description,
    language: prompt.language,
    featured: prompt.featured,
    coverImage: prompt.coverImage,
    thumbnailImage: prompt.thumbnailImage,
    searchText: prompt.searchText,
  }));
}

function buildManifest(prompts, sourceMetadata, imageCount) {
  const languageCounts = new Map();
  prompts.forEach((prompt) => languageCounts.set(prompt.language, (languageCounts.get(prompt.language) || 0) + 1));

  return {
    title: "EvoLink GPT Image 2 Prompts Test",
    source: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
    github: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    count: prompts.length,
    featuredCount: prompts.filter((prompt) => prompt.featured).length,
    imageCount,
    languages: [...languageCounts.entries()].map(([language, count]) => ({ language, count })),
    importedFrom: sourceMetadata.repo || "awesome-gpt-image-2-API-and-Prompts",
    generatedAt: new Date().toISOString(),
  };
}

if (!existsSync(sourceRoot)) {
  throw new Error(`EvoLink repository was not found: ${sourceRoot}`);
}

const sourceMetadata = await readJson(metadataPath);
const metadataByUrl = new Map(sourceMetadata.records.map((record) => [record.tweet_url, record]));
const caseFiles = (await readdir(caseDir)).filter((fileName) => fileName.endsWith("_zh-CN.md")).sort();
const cases = [];

for (const fileName of caseFiles) {
  const markdown = await readFile(path.join(caseDir, fileName), "utf8");
  cases.push(...parseCases(fileName, markdown, metadataByUrl));
}

cases.sort((a, b) => {
  const categoryOrder = Object.keys(fileCategoryFallbacks);
  const aOrder = categoryOrder.indexOf(a.fileName);
  const bOrder = categoryOrder.indexOf(b.fileName);
  return aOrder - bOrder || a.caseNumber - b.caseNumber;
});

const backupDir = await backupCurrentData();
const imageMap = await buildImageMap(cases);
const prompts = toPromptItems(cases, imageMap);
const uniqueImageCount = new Set(prompts.flatMap((prompt) => prompt.images || [])).size;
const manifest = buildManifest(prompts, sourceMetadata, uniqueImageCount);

await mkdir(dataDir, { recursive: true });
await writeFile(path.join(dataDir, "prompts.json"), `${JSON.stringify(prompts, null, 2)}\n`);
await writeFile(path.join(dataDir, "prompts-index.json"), `${JSON.stringify(buildIndex(prompts), null, 2)}\n`);
await writeFile(path.join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Imported ${prompts.length} EvoLink prompts.`);
console.log(`Copied ${uniqueImageCount} local images to ${targetImageRoot}.`);
console.log(`Generated thumbnails in ${targetThumbRoot}.`);
if (backupDir) console.log(`Backed up previous prompt data to ${backupDir}.`);
