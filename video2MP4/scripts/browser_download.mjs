import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const MEDIA_URL_RE = /douyinvod\.com|mime_type=video|media-video|media-audio|\.mp4(?:\?|$)/i;

function parseArgs(argv) {
  const args = {
    outputDir: path.resolve("outputs", "videos"),
    profile: path.resolve("cookies", "browser-profile"),
    channel: "msedge",
    ffmpeg: "ffmpeg",
    mode: "audio",
    waitMs: 15000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url" && next) {
      args.url = next;
      index += 1;
    } else if (arg === "--output-dir" && next) {
      args.outputDir = path.resolve(next);
      index += 1;
    } else if (arg === "--profile" && next) {
      args.profile = path.resolve(next);
      index += 1;
    } else if (arg === "--channel" && next) {
      args.channel = next === "bundled" ? undefined : next;
      index += 1;
    } else if (arg === "--ffmpeg" && next) {
      args.ffmpeg = next;
      index += 1;
    } else if (arg === "--mode" && next) {
      args.mode = next;
      index += 1;
    } else if (arg === "--wait-ms" && next) {
      args.waitMs = Number(next);
      index += 1;
    }
  }

  if (!args.url) {
    throw new Error("Missing --url");
  }
  if (!["audio", "video"].includes(args.mode)) {
    throw new Error("--mode must be audio or video");
  }

  return args;
}

function safeFileName(value) {
  return String(value || "douyin-video")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "douyin-video";
}

function videoIdFromUrl(url) {
  const match = String(url).match(/(?:video\/|modal_id=|aweme_id=)(\d{8,})/);
  return match?.[1];
}

function pickStreams(mediaUrls) {
  const audio = [...mediaUrls].reverse().find((item) => /media-audio|br=48|bt=48/i.test(item.url));
  const video = [...mediaUrls].reverse().find((item) => /media-video|mime_type=video/i.test(item.url) && !/media-audio/i.test(item.url));
  const fallback = [...mediaUrls].reverse().find((item) => /\.mp4|mime_type=video/i.test(item.url));

  return {
    video: video || fallback,
    audio: audio && audio?.url !== video?.url ? audio : undefined,
  };
}

function toFfmpegHeaders(headers = {}) {
  const allowed = [
    "accept",
    "accept-language",
    "origin",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
  ];

  return allowed
    .filter((name) => headers[name])
    .map((name) => `${name}: ${headers[name]}`)
    .join("\r\n") + "\r\n";
}

function addFfmpegInput(ffmpegArgs, stream) {
  const userAgent = stream.headers?.["user-agent"];
  const headers = toFfmpegHeaders(stream.headers);

  if (userAgent) {
    ffmpegArgs.push("-user_agent", userAgent);
  }
  if (headers) {
    ffmpegArgs.push("-headers", headers);
  }
  ffmpegArgs.push("-i", stream.url);
}

async function launchContext(options) {
  const launchOptions = {
    headless: true,
    viewport: { width: 1280, height: 860 },
    locale: "zh-CN",
  };

  if (options.channel) {
    launchOptions.channel = options.channel;
  }

  return chromium.launchPersistentContext(options.profile, launchOptions);
}

async function run(command, args) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}\n${stderr}`));
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(options.profile, { recursive: true });

  let context;
  try {
    context = await launchContext(options);
  } catch (error) {
    if (options.channel) {
      console.warn(`Could not launch ${options.channel}, trying bundled Chromium instead.`);
      context = await launchContext({ ...options, channel: undefined });
    } else {
      throw error;
    }
  }

  const page = context.pages()[0] || await context.newPage();
  const mediaUrls = [];

  page.on("response", async (response) => {
    const responseUrl = response.url();
    const contentType = response.headers()["content-type"] || "";
    if ((MEDIA_URL_RE.test(responseUrl) || /video|audio/i.test(contentType)) && response.status() < 400) {
      const requestHeaders = await response.request().allHeaders().catch(() => response.request().headers());
      mediaUrls.push({ url: responseUrl, headers: requestHeaders });
    }
  });

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(options.waitMs);

  await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!video) {
      return;
    }
    video.muted = true;
    await video.play().catch(() => {});
  });
  await page.waitForTimeout(5000);

  const pageInfo = await page.evaluate(() => ({
    title: document.title,
    videoCount: document.querySelectorAll("video").length,
  }));

  await context.close();

  const streams = pickStreams(uniqueMediaItems(mediaUrls));
  if (!streams.video && !streams.audio) {
    throw new Error(`Could not find a playable media URL. Page title: ${pageInfo.title}`);
  }

  const outputName = videoIdFromUrl(options.url) || safeFileName(pageInfo.title);
  const wantsAudioOnly = options.mode === "audio" && streams.audio;
  const output = path.join(options.outputDir, `${outputName}${wantsAudioOnly ? ".m4a" : ".mp4"}`);
  const ffmpegArgs = ["-y"];

  if (wantsAudioOnly) {
    addFfmpegInput(ffmpegArgs, streams.audio);
    ffmpegArgs.push("-vn", "-c", "copy");
  } else if (streams.video && streams.audio) {
    addFfmpegInput(ffmpegArgs, streams.video);
    addFfmpegInput(ffmpegArgs, streams.audio);
    ffmpegArgs.push("-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest");
  } else {
    addFfmpegInput(ffmpegArgs, streams.video);
    ffmpegArgs.push("-c", "copy");
  }

  ffmpegArgs.push(output);
  await run(options.ffmpeg, ffmpegArgs);

  console.log(`BROWSER_DOWNLOAD_RESULT=${JSON.stringify({
    output,
    title: pageInfo.title,
    streamCount: mediaUrls.length,
    hasVideo: Boolean(streams.video),
    hasAudio: Boolean(streams.audio),
  })}`);
}

function uniqueMediaItems(items) {
  const byUrl = new Map();
  for (const item of items) {
    byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
