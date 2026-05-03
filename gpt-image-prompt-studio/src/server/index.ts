import cors from "cors";
import "dotenv/config";
import express from "express";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const app = express();
const port = Number(process.env.PORT || 8787);
const defaultBaseUrl = "https://api.openai.com/v1";
const defaultRequestTimeoutMs = 120_000;
const projectRoot = process.cwd();
const distDir = join(projectRoot, "dist");
const generatedDir = join(projectRoot, "public", "generated");
const imageCacheDir = join(projectRoot, "public", "image-cache");
const imageThumbsDir = join(projectRoot, "public", "image-thumbs");
const promptsPath = join(projectRoot, "public", "data", "prompts.json");
const manifestPath = join(projectRoot, "public", "data", "manifest.json");
const promptIndexPath = join(projectRoot, "public", "data", "prompts-index.json");
let promptCache: Array<{ id: number }> | null = null;
let promptCacheMtimeMs = 0;
const execFileAsync = promisify(execFile);
const cachedImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

app.use(cors({ origin: ["http://127.0.0.1:5180", "http://localhost:5180"] }));
app.use(express.json({ limit: "25mb" }));

function toOpenAIImageSize(aspectRatio: string) {
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "16:9") return "1536x1024";
  if (aspectRatio === "9:16") return "1024x1536";
  return "auto";
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function getImageEndpoint() {
  if (process.env.OPENAI_IMAGE_ENDPOINT) {
    return process.env.OPENAI_IMAGE_ENDPOINT;
  }

  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || defaultBaseUrl);
  return `${baseUrl}/images/generations`;
}

function getImageEditEndpoint() {
  if (process.env.OPENAI_IMAGE_EDIT_ENDPOINT) {
    return process.env.OPENAI_IMAGE_EDIT_ENDPOINT;
  }

  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || defaultBaseUrl);
  return `${baseUrl}/images/edits`;
}

function getRequestTimeoutMs() {
  const timeoutMs = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || defaultRequestTimeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultRequestTimeoutMs;
}

function sanitizeEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint.replace(/^https?:\/\/([^/@]+@)?/, "https://");
  }
}

function dataUrlToFile(dataUrl: string, fallbackName: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const buffer = Buffer.from(base64, "base64");
  return new File([buffer], `${fallbackName}.${extension}`, { type: mimeType });
}

async function saveBase64Image(base64: string) {
  await mkdir(generatedDir, { recursive: true });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.png`;
  const filePath = join(generatedDir, fileName);
  await writeFile(filePath, Buffer.from(base64, "base64"));
  return {
    fileName,
    filePath,
    imageUrl: `/api/generated/${fileName}`,
  };
}

function getGeneratedExtension(contentType = "", url = "") {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return ".jpg";
  if (normalizedType.includes("png")) return ".png";
  if (normalizedType.includes("webp")) return ".webp";

  try {
    const pathExtension = extname(new URL(url).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(pathExtension)) return pathExtension;
  } catch {
    // Use png by default.
  }

  return ".png";
}

async function saveRemoteImage(url: string) {
  await mkdir(generatedDir, { recursive: true });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const upstreamResponse = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!upstreamResponse.ok) {
      throw new Error(`图片下载失败，状态码 ${upstreamResponse.status}。`);
    }

    const contentType = upstreamResponse.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
      throw new Error("图片接口返回的不是图片内容。");
    }

    const extension = getGeneratedExtension(contentType, url);
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}${extension}`;
    const filePath = join(generatedDir, fileName);
    await writeFile(filePath, Buffer.from(await upstreamResponse.arrayBuffer()));

    return {
      fileName,
      filePath,
      imageUrl: `/api/generated/${fileName}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getGeneratedContentType(fileName: string) {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function fetchProvider(endpoint: string, init: RequestInit) {
  const timeoutMs = getRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(endpoint, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`中转接口超过 ${Math.round(timeoutMs / 1000)} 秒没有返回。可以稍后重试，或把质量改成 medium/low 再生成。`);
    }

    throw new Error(`连接中转接口失败：${error instanceof Error ? error.message : "网络请求失败"}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readOpenAIResponse(openAIResponse: globalThis.Response, endpoint: string) {
  const responseText = await openAIResponse.text();

  if (!responseText.trim()) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    const compactText = responseText.replace(/\s+/g, " ").trim();
    const visibleEndpoint = sanitizeEndpoint(endpoint);

    if (/404 page not found/i.test(compactText)) {
      throw new Error(`中转接口路径不存在：POST ${visibleEndpoint}。请在 BeeCode 后台或文档确认 gpt-image-2 的图片生成接口，然后把 .env 里的 OPENAI_IMAGE_ENDPOINT 改成完整地址。`);
    }

    if (/cloudflare|cf-error|no-js ie\d oldie|ray id/i.test(compactText)) {
      throw new Error(`中转站返回了网页错误页，通常是 BeeCode 接口超时、被 Cloudflare 拦截，或当前图片接口不可用。可以稍后重试，或把质量改成 medium/low；如果持续出现，请向 BeeCode 确认 gpt-image-2 的生图接口地址。`);
    }

    if (/<!doctype|<html/i.test(compactText)) {
      throw new Error(`中转接口返回了网页内容，不是 JSON。当前调用的是 POST ${visibleEndpoint}，请确认这个地址是否支持图片生成。`);
    }

    throw new Error(`中转接口返回了非 JSON 内容：${compactText.slice(0, 180)}`);
  }
}

function getOpenAIErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }

  const maybeData = data as {
    error?: string | { message?: string };
    message?: string;
  };

  if (typeof maybeData.error === "string") {
    return maybeData.error;
  }

  return maybeData.error?.message || maybeData.message || "";
}

async function readPrompts() {
  const promptStat = await stat(promptsPath);

  if (!promptCache || promptStat.mtimeMs !== promptCacheMtimeMs) {
    promptCache = JSON.parse(await readFile(promptsPath, "utf8")) as Array<{ id: number }>;
    promptCacheMtimeMs = promptStat.mtimeMs;
  }

  return promptCache;
}

function getImageExtension(url: URL, contentType = "") {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  const pathExtension = extname(url.pathname).toLowerCase();
  if (cachedImageExtensions.includes(pathExtension)) return pathExtension;
  return ".jpg";
}

async function findCachedImage(hash: string) {
  for (const extension of cachedImageExtensions) {
    const filePath = join(imageCacheDir, `${hash}${extension}`);
    try {
      await stat(filePath);
      return filePath;
    } catch {
      // Try the next possible extension.
    }
  }

  return "";
}

async function buildImageThumbnail(sourcePath: string, targetPath: string) {
  await mkdir(imageThumbsDir, { recursive: true });
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

async function downloadImageToCache(imageUrl: URL, filePath: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);

  try {
    const upstreamResponse = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      signal: controller.signal,
    });

    if (upstreamResponse.ok) {
      const contentType = upstreamResponse.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        throw new Error("Unsupported content type");
      }

      const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
      await writeFile(filePath, buffer);
      return contentType;
    }
  } catch {
    // Fall back to Windows networking below; it is more reliable for this CDN on some machines.
  } finally {
    clearTimeout(timeout);
  }

  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:IMAGE_URL -OutFile $env:IMAGE_FILE -TimeoutSec 45 -Headers @{ 'User-Agent'='Mozilla/5.0' }",
    ],
    {
      env: {
        ...process.env,
        IMAGE_URL: imageUrl.href,
        IMAGE_FILE: filePath,
      },
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );

  return "image/jpeg";
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    hasKey: Boolean(process.env.OPENAI_API_KEY),
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || defaultBaseUrl),
    imageEndpoint: getImageEndpoint().replace(/^https?:\/\/([^/@]+@)?/, "https://"),
    imageEditEndpoint: getImageEditEndpoint().replace(/^https?:\/\/([^/@]+@)?/, "https://"),
    timeoutSeconds: Math.round(getRequestTimeoutMs() / 1000),
  });
});

app.get("/api/generated/:fileName", async (request, response) => {
  const fileName = basename(request.params.fileName || "");

  if (!fileName || fileName !== request.params.fileName || !/\.(png|jpe?g|webp)$/i.test(fileName)) {
    response.status(400).send("Invalid generated image name");
    return;
  }

  const filePath = join(generatedDir, fileName);

  try {
    await stat(filePath);
    response.setHeader("Cache-Control", "no-store");
    response.type(getGeneratedContentType(fileName));
    response.sendFile(filePath);
  } catch {
    response.status(404).send("Generated image not found");
  }
});

app.get("/api/manifest", async (_request, response) => {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.type("json").send(await readFile(manifestPath, "utf8"));
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Manifest read failed",
    });
  }
});

app.get("/api/prompts-index", async (_request, response) => {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.type("json").send(await readFile(promptIndexPath, "utf8"));
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Prompt index read failed",
    });
  }
});

app.get("/api/image-proxy", async (request, response) => {
  const rawUrl = String(request.query.url || "");

  try {
    const imageUrl = new URL(rawUrl);

    if (imageUrl.hostname !== "cms-assets.youmind.com") {
      response.status(400).send("Unsupported image host");
      return;
    }

    await mkdir(imageCacheDir, { recursive: true });

    const hash = createHash("sha1").update(imageUrl.href).digest("hex");
    const extension = getImageExtension(imageUrl);
    const targetFilePath = join(imageCacheDir, `${hash}${extension}`);

    const cachedFilePath = await findCachedImage(hash);
    if (cachedFilePath) {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.sendFile(cachedFilePath);
      return;
    }

    const contentType = await downloadImageToCache(imageUrl, targetFilePath);

    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.type(contentType);
    response.sendFile(targetFilePath);
  } catch (error) {
    response.status(502).send(error instanceof Error ? error.message : "Image fetch failed");
  }
});

app.get("/api/image-thumb", async (request, response) => {
  const rawUrl = String(request.query.url || "");

  try {
    const imageUrl = new URL(rawUrl);

    if (imageUrl.hostname !== "cms-assets.youmind.com") {
      response.status(400).send("Unsupported image host");
      return;
    }

    await mkdir(imageCacheDir, { recursive: true });
    await mkdir(imageThumbsDir, { recursive: true });

    const hash = createHash("sha1").update(imageUrl.href).digest("hex");
    const thumbFilePath = join(imageThumbsDir, `${hash}.webp`);

    try {
      await stat(thumbFilePath);
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.type("image/webp").sendFile(thumbFilePath);
      return;
    } catch {
      // Build it below.
    }

    let cachedFilePath = await findCachedImage(hash);
    if (!cachedFilePath) {
      const extension = getImageExtension(imageUrl);
      cachedFilePath = join(imageCacheDir, `${hash}${extension}`);
      await downloadImageToCache(imageUrl, cachedFilePath);
    }

    await buildImageThumbnail(cachedFilePath, thumbFilePath);

    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.type("image/webp").sendFile(thumbFilePath);
  } catch (error) {
    response.status(502).send(error instanceof Error ? error.message : "Image thumbnail failed");
  }
});

app.get("/api/prompts/:id", async (request, response) => {
  const promptId = Number(request.params.id);

  if (!Number.isFinite(promptId)) {
    response.status(400).json({ error: "模板 ID 不正确。" });
    return;
  }

  try {
    const prompts = await readPrompts();
    const prompt = prompts.find((item) => item.id === promptId);

    if (!prompt) {
      response.status(404).json({ error: "没有找到这个模板。" });
      return;
    }

    response.json(prompt);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "模板读取失败。",
    });
  }
});

app.post("/api/generate", async (request, response) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const {
    prompt,
    model = "gpt-image-2",
    aspectRatio = "auto",
    quality = "auto",
    referenceImages = [],
  } = request.body ?? {};

  if (!apiKey) {
    response.status(400).json({
      error: "还没有配置 OPENAI_API_KEY。请在项目根目录 .env 文件里添加 OPENAI_API_KEY=你的密钥，然后重启后端。",
    });
    return;
  }

  if (!prompt || typeof prompt !== "string") {
    response.status(400).json({ error: "提示词不能为空。" });
    return;
  }

  try {
    const validReferenceImages = Array.isArray(referenceImages)
      ? referenceImages.filter((item) => typeof item === "string" && item.startsWith("data:image/"))
      : [];

    let openAIResponse: globalThis.Response;

    if (validReferenceImages.length > 0) {
      const formData = new FormData();
      formData.set("model", model);
      formData.set("prompt", prompt);
      formData.set("n", "1");
      formData.set("size", toOpenAIImageSize(aspectRatio));
      if (quality && quality !== "auto") {
        formData.set("quality", quality);
      }

      validReferenceImages.slice(0, 4).forEach((dataUrl, index) => {
        const file = dataUrlToFile(dataUrl, `reference-${index + 1}`);
        if (file) formData.append("image", file);
      });

      const imageEditEndpoint = getImageEditEndpoint();

      openAIResponse = await fetchProvider(imageEditEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });
    } else {
      const imageEndpoint = getImageEndpoint();
      const payload: Record<string, unknown> = {
        model,
        prompt,
        n: 1,
        size: toOpenAIImageSize(aspectRatio),
      };

      if (quality && quality !== "auto") {
        payload.quality = quality;
      }

      openAIResponse = await fetchProvider(imageEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    }

    const endpoint = validReferenceImages.length > 0 ? getImageEditEndpoint() : getImageEndpoint();
    const data = await readOpenAIResponse(openAIResponse, endpoint) as {
      data?: Array<{
        b64_json?: string;
        url?: string;
      }>;
    };

    if (!openAIResponse.ok) {
      response.status(openAIResponse.status).json({
        error: getOpenAIErrorMessage(data) || `图像接口返回错误，状态码 ${openAIResponse.status}。`,
      });
      return;
    }

    const item = data.data?.[0];
    let imageUrl = item?.url || "";
    let filePath = "";

    if (item?.b64_json) {
      const saved = await saveBase64Image(item.b64_json);
      imageUrl = saved.imageUrl;
      filePath = saved.filePath;
    } else if (item?.url) {
      const saved = await saveRemoteImage(item.url);
      imageUrl = saved.imageUrl;
      filePath = saved.filePath;
    }

    if (!imageUrl) {
      response.status(502).json({ error: "接口没有返回图片。" });
      return;
    }

    response.json({ imageUrl, filePath });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "生成请求失败。",
    });
  }
});

app.use("/generated", express.static(generatedDir, {
  maxAge: 0,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
  },
}));
app.use("/image-cache", express.static(imageCacheDir, {
  maxAge: "1y",
  immutable: true,
}));
app.use("/image-thumbs", express.static(imageThumbsDir, {
  maxAge: "1y",
  immutable: true,
}));
app.use(express.static(distDir, {
  setHeaders(response, filePath) {
    const normalizedFilePath = filePath.replace(/\\/g, "/");

    if (normalizedFilePath.endsWith("/index.html") || normalizedFilePath.includes("/data/")) {
      response.setHeader("Cache-Control", "no-store");
      return;
    }

    if (normalizedFilePath.includes("/assets/")) {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

app.use((request, response, next) => {
  if (request.method !== "GET" || !request.accepts("html")) {
    next();
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.sendFile(join(distDir, "index.html"), (error) => {
    if (error) {
      next(error);
    }
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Prompt Studio running at http://127.0.0.1:${port}`);
});
