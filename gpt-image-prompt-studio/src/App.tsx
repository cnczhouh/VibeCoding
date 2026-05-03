import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Heart,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { applyArguments, extractArguments } from "./promptArguments";
import { readStorage, writeStorage } from "./storage";
import type { ImageResult, PromptItem } from "./types";

const languages = ["全部", "zh", "en", "ja", "ko"];
const aspectRatios = ["auto", "1:1", "16:9", "9:16"] as const;
const qualities = ["auto", "low", "medium", "high"] as const;
type FilterOption = {
  id: string;
  label: string;
  keywords: string[];
};

type FilterGroup = {
  id: string;
  label: string;
  options: FilterOption[];
};

type FilterChoice = FilterOption & {
  groupId: string;
};

const filterGroups: FilterGroup[] = [
  {
    id: "scenario",
    label: "使用场景",
    options: [
      { id: "scenario-profile", label: "个人资料 / 头像", keywords: ["个人资料", "头像", "avatar", "portrait", "headshot", "profile", "肖像", "证件照"] },
      { id: "scenario-social", label: "社交媒体帖子", keywords: ["社交媒体", "社媒", "post", "instagram", "twitter", "x ", "小红书", "朋友圈", "feed"] },
      { id: "scenario-infographic", label: "信息图 / 教育视觉图", keywords: ["信息图", "教育", "图解", "infographic", "diagram", "chart", "流程图", "知识", "slides"] },
      { id: "scenario-youtube", label: "YouTube 缩略图", keywords: ["youtube", "缩略图", "thumbnail", "封面", "cover", "视频封面"] },
      { id: "scenario-storyboard", label: "漫画 / 故事板", keywords: ["漫画", "故事板", "storyboard", "comic", "manga", "分镜", "连环画"] },
      { id: "scenario-marketing", label: "产品营销", keywords: ["营销", "广告", "宣传", "campaign", "marketing", "ad ", "poster", "banner"] },
      { id: "scenario-ecommerce", label: "电商主图", keywords: ["电商", "主图", "商品", "产品图", "product", "packshot", "包装", "详情页"] },
      { id: "scenario-game", label: "游戏素材", keywords: ["游戏", "game", "asset", "icon", "sprite", "道具", "角色立绘", "场景"] },
      { id: "scenario-poster", label: "海报 / 传单", keywords: ["海报", "传单", "poster", "flyer", "宣传单", "活动"] },
      { id: "scenario-app", label: "App / 网页设计", keywords: ["app", "web", "ui", "网页", "网站", "界面", "dashboard", "screenshot"] },
    ],
  },
  {
    id: "style",
    label: "风格",
    options: [
      { id: "style-photo", label: "摄影", keywords: ["摄影", "照片", "photo", "photography", "photorealistic", "写实", "realistic"] },
      { id: "style-cinematic", label: "电影 / 电影剧照", keywords: ["电影", "剧照", "cinematic", "film still", "镜头", "电影感", "大片"] },
      { id: "style-anime", label: "动漫 / 漫画", keywords: ["动漫", "漫画", "anime", "manga", "comic", "cel shading"] },
      { id: "style-illustration", label: "插画", keywords: ["插画", "illustration", "绘本", "手绘", "cartoon"] },
      { id: "style-sketch", label: "草图 / 线稿", keywords: ["草图", "线稿", "sketch", "line art", "线条", "铅笔"] },
      { id: "style-graphic-novel", label: "漫画 / 图画小说", keywords: ["图画小说", "graphic novel", "comic book", "美漫", "连环画"] },
      { id: "style-3d", label: "3D 渲染", keywords: ["3d", "三维", "渲染", "render", "blender", "c4d", "octane"] },
      { id: "style-chibi", label: "Q版 / Q萌风", keywords: ["q版", "q萌", "chibi", "可爱", "萌", "cute"] },
      { id: "style-isometric", label: "等距", keywords: ["等距", "isometric", "轴测", "低多边形"] },
      { id: "style-pixel", label: "像素艺术", keywords: ["像素", "pixel", "pixel art", "8-bit", "16-bit"] },
      { id: "style-oil", label: "油画", keywords: ["油画", "oil painting", "厚涂", "画布"] },
      { id: "style-watercolor", label: "水彩画", keywords: ["水彩", "watercolor", "淡彩"] },
      { id: "style-ink", label: "水墨 / 中国风", keywords: ["水墨", "中国风", "国风", "ink wash", "山水", "宣纸"] },
      { id: "style-retro", label: "复古 / 怀旧", keywords: ["复古", "怀旧", "retro", "vintage", "旧海报", "胶片"] },
      { id: "style-cyberpunk", label: "赛博朋克 / 科幻", keywords: ["赛博", "科幻", "cyberpunk", "sci-fi", "未来", "霓虹"] },
      { id: "style-minimal", label: "极简主义", keywords: ["极简", "minimal", "简洁", "留白", "clean"] },
    ],
  },
  {
    id: "subject",
    label: "主体",
    options: [
      { id: "subject-portrait", label: "人像 / 自拍", keywords: ["人像", "自拍", "portrait", "selfie", "face", "人物"] },
      { id: "subject-influencer", label: "网红 / 模特", keywords: ["网红", "模特", "influencer", "model", "fashion model"] },
      { id: "subject-character", label: "角色", keywords: ["角色", "character", "mascot", "ip", "英雄", "主角"] },
      { id: "subject-group", label: "团体 / 情侣", keywords: ["团体", "情侣", "group", "couple", "family", "团队"] },
      { id: "subject-product", label: "产品", keywords: ["产品", "商品", "product", "packaging", "bottle", "device", "VR", "手机"] },
      { id: "subject-food", label: "食品 / 饮料", keywords: ["食品", "饮料", "食物", "美食", "food", "drink", "coffee", "甜品"] },
      { id: "subject-fashion", label: "时尚单品", keywords: ["时尚", "服装", "鞋", "包", "fashion", "clothing", "sneaker"] },
      { id: "subject-creature", label: "动物 / 生物", keywords: ["动物", "宠物", "猫", "狗", "animal", "creature", "生物"] },
      { id: "subject-vehicle", label: "车辆", keywords: ["车辆", "汽车", "车", "vehicle", "car", "motorcycle", "飞船"] },
      { id: "subject-space", label: "建筑 / 室内设计", keywords: ["建筑", "室内", "空间", "interior", "architecture", "房间", "店铺"] },
      { id: "subject-landscape", label: "风景 / 自然", keywords: ["风景", "自然", "landscape", "nature", "山", "森林", "海"] },
      { id: "subject-city", label: "城市风光 / 街道", keywords: ["城市", "街道", "city", "street", "都市", "夜景"] },
      { id: "subject-chart", label: "图表", keywords: ["图表", "chart", "graph", "diagram", "数据", "流程"] },
      { id: "subject-typography", label: "文本 / 排版", keywords: ["文本", "文字", "排版", "typography", "lettering", "logo", "字体"] },
      { id: "subject-abstract", label: "摘要 / 背景", keywords: ["抽象", "背景", "abstract", "background", "texture", "pattern"] },
    ],
  },
];

const allFilterOptions: FilterChoice[] = filterGroups.flatMap((group) =>
  group.options.map((option) => ({ ...option, groupId: group.id })),
);

type AspectRatio = (typeof aspectRatios)[number];
type Quality = (typeof qualities)[number];
type Page = "workbench" | "gallery";
const galleryPageSize = 20;
const initialGalleryImageLimit = 0;
const galleryImageBatchSize = 6;
const galleryImageLoadDelayMs = 650;
const previewImageLoadDelayMs = 450;
const defaultManifest = {
  count: 3828,
  imageCount: 4536,
};
const lineBreakPattern = /\r\n|\r|\n/g;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function rankPrompt(prompt: PromptItem, query: string) {
  if (!query) return prompt.featured ? 10 : 0;

  const title = prompt.title.toLowerCase();
  const description = prompt.description.toLowerCase();
  const searchText = prompt.searchText?.toLowerCase() ?? "";
  let score = 0;

  if (title.includes(query)) score += 40;
  if (description.includes(query)) score += 20;
  if (searchText.includes(query)) score += 8;
  if (prompt.featured) score += 6;

  return score;
}

function getPromptSearchText(prompt: PromptItem) {
  return `${prompt.title}\n${prompt.description}\n${prompt.searchText ?? ""}`.toLowerCase();
}

function matchesFilterOption(prompt: PromptItem, option: FilterOption) {
  const searchText = getPromptSearchText(prompt);
  return option.keywords.some((keyword) => searchText.includes(keyword.toLowerCase()));
}

function matchesSelectedFilters(prompt: PromptItem, options: FilterChoice[]) {
  const groupedOptions = new Map<string, FilterChoice[]>();

  for (const option of options) {
    groupedOptions.set(option.groupId, [...(groupedOptions.get(option.groupId) ?? []), option]);
  }

  return Array.from(groupedOptions.values()).every((groupOptions) =>
    groupOptions.some((option) => matchesFilterOption(prompt, option)),
  );
}

function getPromptMatchedLabel(prompt: PromptItem) {
  return allFilterOptions.find((option) => matchesFilterOption(prompt, option))?.label ?? prompt.language;
}

function getImageUrl(url?: string) {
  if (!url) return "";
  if (url.startsWith("/api/image-proxy")) return url;

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

function withCacheBust(path: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${Date.now()}`;
}

function isLocalGeneratedImage(url?: string) {
  return Boolean(url && (url.startsWith("/api/generated/") || url.startsWith("/generated/")));
}

function normalizeGeneratedImageUrl(url: string) {
  if (url.startsWith("/generated/")) {
    return url.replace("/generated/", "/api/generated/");
  }

  return url;
}

async function fetchJson<T>(paths: string[]) {
  let lastError: unknown = null;

  for (const path of paths) {
    try {
      const response = await fetch(withCacheBust(path), { cache: "no-store" });
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("JSON load failed");
}

export default function App() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [manifest, setManifest] = useState(defaultManifest);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("全部");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [activePage, setActivePage] = useState<Page>("workbench");
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryImageLimit, setGalleryImageLimit] = useState(initialGalleryImageLimit);
  const [canLoadPreviewImage, setCanLoadPreviewImage] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptItem | null>(null);
  const [argumentValues, setArgumentValues] = useState<Record<string, string>>({});
  const [manualPrompt, setManualPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [quality, setQuality] = useState<Quality>("auto");
  const [model, setModel] = useState("gpt-image-2");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<number[]>(() => readStorage("promptStudio:favorites", []));
  const [history, setHistory] = useState<ImageResult[]>(() =>
    readStorage<ImageResult[]>("promptStudio:history", [])
      .filter((item) => isLocalGeneratedImage(item.imageUrl))
      .map((item) => ({ ...item, imageUrl: normalizeGeneratedImageUrl(item.imageUrl) })),
  );
  const [failedGalleryImages, setFailedGalleryImages] = useState<string[]>([]);
  const [failedResultImages, setFailedResultImages] = useState<string[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [error, setError] = useState("");

  const args = useMemo(() => extractArguments(selectedPrompt?.prompt ?? ""), [selectedPrompt]);
  const finalPrompt = useMemo(
    () => applyArguments(manualPrompt, argumentValues),
    [manualPrompt, argumentValues],
  );
  const promptLineCount = useMemo(() => {
    const lineBreaks = manualPrompt.match(lineBreakPattern)?.length ?? 0;
    const visualLines = Math.ceil(Math.max(manualPrompt.length, 1) / 92);
    return Math.min(18, Math.max(4, lineBreaks + visualLines));
  }, [manualPrompt]);
  const activeFilterOptions = useMemo(
    () => selectedFilterIds.map((id) => allFilterOptions.find((option) => option.id === id)).filter(Boolean) as FilterChoice[],
    [selectedFilterIds],
  );
  const failedGalleryImageSet = useMemo(() => new Set(failedGalleryImages), [failedGalleryImages]);

  const filteredPromptMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return prompts
      .map((prompt) => ({ prompt, score: rankPrompt(prompt, normalizedQuery) }))
      .filter(({ prompt, score }) => {
        if (activeFilterOptions.length && !matchesSelectedFilters(prompt, activeFilterOptions)) return false;
        if (featuredOnly && !prompt.featured) return false;
        if (favoritesOnly && !favorites.includes(prompt.id)) return false;
        if (language !== "全部" && prompt.language !== language) return false;
        if (normalizedQuery && score <= 0) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score || Number(b.prompt.featured) - Number(a.prompt.featured))
      .map(({ prompt }) => prompt);
  }, [activeFilterOptions, favorites, favoritesOnly, featuredOnly, language, prompts, query]);
  const galleryPageCount = Math.max(1, Math.ceil(filteredPromptMatches.length / galleryPageSize));
  const safeGalleryPage = Math.min(galleryPage, galleryPageCount);
  const filteredPrompts = useMemo(() => {
    const start = (safeGalleryPage - 1) * galleryPageSize;
    return filteredPromptMatches.slice(start, start + galleryPageSize);
  }, [filteredPromptMatches, safeGalleryPage]);
  const galleryStart = filteredPromptMatches.length ? (safeGalleryPage - 1) * galleryPageSize + 1 : 0;
  const galleryEnd = Math.min(safeGalleryPage * galleryPageSize, filteredPromptMatches.length);
  const canGoPrevious = safeGalleryPage > 1;
  const canGoNext = safeGalleryPage < galleryPageCount;

  const selectedResult = useMemo(
    () => history.find((item) => item.id === selectedResultId) ?? null,
    [history, selectedResultId],
  );
  const failedResultImageSet = useMemo(() => new Set(failedResultImages), [failedResultImages]);

  useEffect(() => {
    async function loadManifest() {
      const nextManifest = await fetchJson<Partial<typeof defaultManifest>>([
        "/data/manifest.json",
        "/api/manifest",
      ]);

      setManifest({
        count: Number(nextManifest.count) || defaultManifest.count,
        imageCount: Number(nextManifest.imageCount) || defaultManifest.imageCount,
      });
    }

    loadManifest().catch(() => {
      setManifest(defaultManifest);
    });
  }, []);

  useEffect(() => {
    async function loadPrompts() {
      const nextPrompts = await fetchJson<PromptItem[]>([
        "/data/prompts-index.json",
        "/api/prompts-index",
      ]);

      setPrompts(nextPrompts);
      setManifest((current) => ({
        count: nextPrompts.length || current.count || defaultManifest.count,
        imageCount: current.imageCount || defaultManifest.imageCount,
      }));
    }

    loadPrompts().catch(() => {
      setError("模板列表加载失败，请刷新页面重试。");
    });
  }, []);

  useEffect(() => {
    const values = Object.fromEntries(args.map((arg) => [arg.key, arg.defaultValue]));
    setArgumentValues(values);
    setManualPrompt(selectedPrompt?.prompt ? applyArguments(selectedPrompt.prompt, values) : "");
    setError("");
  }, [args, selectedPrompt]);

  useEffect(() => {
    writeStorage("promptStudio:favorites", favorites);
  }, [favorites]);

  useEffect(() => {
    writeStorage("promptStudio:history", history);
  }, [history]);

  useEffect(() => {
    setGalleryPage(1);
  }, [favoritesOnly, featuredOnly, language, query, selectedFilterIds]);

  useEffect(() => {
    setGalleryPage((current) => Math.min(current, galleryPageCount));
  }, [galleryPageCount]);

  useEffect(() => {
    setGalleryImageLimit(initialGalleryImageLimit);
  }, [activePage, favoritesOnly, featuredOnly, language, query, safeGalleryPage, selectedFilterIds]);

  useEffect(() => {
    if (activePage !== "gallery" || galleryImageLimit >= filteredPrompts.length) return;

    const timer = window.setTimeout(() => {
      setGalleryImageLimit((current) => Math.min(filteredPrompts.length, current + galleryImageBatchSize));
    }, galleryImageLimit === 0 ? galleryImageLoadDelayMs : 420);

    return () => window.clearTimeout(timer);
  }, [activePage, filteredPrompts.length, galleryImageLimit]);

  useEffect(() => {
    setCanLoadPreviewImage(false);
    if (!selectedPrompt?.coverImage) return;

    const timer = window.setTimeout(() => {
      setCanLoadPreviewImage(true);
    }, previewImageLoadDelayMs);

    return () => window.clearTimeout(timer);
  }, [selectedPrompt?.id, selectedPrompt?.coverImage]);

  function toggleFavorite(id: number) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [id, ...current].slice(0, 120),
    );
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(finalPrompt);
  }

  async function hydratePrompt(prompt: PromptItem) {
    if (prompt.prompt) return prompt;

    setIsLoadingPrompt(true);
    try {
      const response = await fetch(`/api/prompts/${prompt.id}`);
      const detail = await response.json() as PromptItem | { error?: string };

      if (!response.ok || "error" in detail) {
        throw new Error("error" in detail ? detail.error || "模板加载失败" : "模板加载失败");
      }

      setPrompts((current) => current.map((item) => (item.id === prompt.id ? { ...item, ...detail } : item)));
      return { ...prompt, ...detail };
    } finally {
      setIsLoadingPrompt(false);
    }
  }

  async function inspireMe() {
    const pool = filteredPromptMatches.length > 0 ? filteredPromptMatches : prompts;
    if (!pool.length) return;

    const nextPrompt = pool[Math.floor(Math.random() * pool.length)];
    await selectPrompt(nextPrompt);
  }

  async function selectPrompt(prompt: PromptItem) {
    setError("");

    try {
      const hydratedPrompt = await hydratePrompt(prompt);
      setSelectedPrompt(hydratedPrompt);
      setActivePage("workbench");
      setQuery("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (event) {
      setError(event instanceof Error ? event.message : "模板加载失败");
    }
  }

  function toggleFilterOption(filterId: string) {
    setSelectedFilterIds((current) =>
      current.includes(filterId) ? current.filter((id) => id !== filterId) : [...current, filterId],
    );
  }

  function clearGalleryFilters() {
    setSelectedFilterIds([]);
    setFeaturedOnly(false);
    setFavoritesOnly(false);
    setLanguage("全部");
  }

  function markGalleryImageFailed(url: string) {
    setFailedGalleryImages((current) => (current.includes(url) ? current : [...current, url].slice(-500)));
  }

  function markResultImageFailed(url: string) {
    setFailedResultImages((current) => (current.includes(url) ? current : [...current, url].slice(-120)));
  }

  function removeFailedResult(id: string) {
    setHistory((current) => current.filter((item) => item.id !== id));
    setSelectedResultId((current) => (current === id ? null : current));
  }

  function changeGalleryPage(page: number) {
    const nextPage = Math.min(Math.max(1, page), galleryPageCount);
    setGalleryPage(nextPage);
    requestAnimationFrame(() => {
      document.querySelector(".template-gallery-section")?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }

  function renderGalleryPagination() {
    return (
      <div className="pagination-row" aria-label="模板分页">
        <span>
          第 {safeGalleryPage} / {galleryPageCount} 页
        </span>
        <div className="pagination-actions">
          <button type="button" onClick={() => changeGalleryPage(safeGalleryPage - 1)} disabled={!canGoPrevious}>
            <ChevronLeft size={16} />
            上一页
          </button>
          <button type="button" onClick={() => changeGalleryPage(safeGalleryPage + 1)} disabled={!canGoNext}>
            下一页
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  function renderFilterPanel() {
    if (!isFilterPanelOpen) return null;

    return (
      <div className="filter-panel-backdrop" role="presentation" onClick={() => setIsFilterPanelOpen(false)}>
        <section className="filter-panel" role="dialog" aria-modal="true" aria-label="筛选模板" onClick={(event) => event.stopPropagation()}>
          <div className="filter-panel-head">
            <strong>筛选</strong>
            <button type="button" aria-label="关闭筛选" onClick={() => setIsFilterPanelOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="filter-groups">
            {filterGroups.map((group) => (
              <div className="filter-group" key={group.id}>
                <h3>{group.label}</h3>
                <div className="filter-tags">
                  {group.options.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      aria-pressed={selectedFilterIds.includes(option.id)}
                      onClick={() => toggleFilterOption(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="filter-panel-actions">
            <button type="button" onClick={clearGalleryFilters}>
              清空选择
            </button>
            <button type="button" onClick={() => setIsFilterPanelOpen(false)}>
              确定
            </button>
          </div>
        </section>
      </div>
    );
  }

  async function addReferenceImages(files: FileList | null) {
    if (!files?.length) return;

    const imageFiles = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, 4 - referenceImages.length);

    const dataUrls = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("参考图读取失败"));
            reader.readAsDataURL(file);
          }),
      ),
    );

    setReferenceImages((current) => [...current, ...dataUrls].slice(0, 4));
  }

  async function generateImage() {
    const prompt = finalPrompt.trim();
    if (!prompt) {
      setError("请先写提示词，或从左侧选择一个模板。");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model,
          aspectRatio,
          quality,
          referenceImages,
        }),
      });

      const responseText = await response.text();
      let data: { imageUrl?: string; filePath?: string; error?: string } = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(responseText.slice(0, 240) || "生成接口返回了无法解析的内容。");
      }

      if (!response.ok) throw new Error(data.error || "生成失败");
      if (!data.imageUrl) throw new Error("生成接口没有返回图片。");

      const result: ImageResult = {
        id: crypto.randomUUID(),
        prompt,
        imageUrl: normalizeGeneratedImageUrl(data.imageUrl),
        filePath: data.filePath,
        createdAt: new Date().toISOString(),
      };

      setHistory((current) => [result, ...current].slice(0, 30));
      setSelectedResultId(result.id);
    } catch (event) {
      setError(event instanceof Error ? event.message : "生成失败");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span>IMG STUDIO BY ZH</span>
          <strong>GPT生图系统V1.1</strong>
        </div>
        <nav className="page-tabs" aria-label="页面切换">
          <button
            type="button"
            aria-pressed={activePage === "workbench"}
            onClick={() => setActivePage("workbench")}
          >
            工作台
          </button>
          <button
            type="button"
            aria-pressed={activePage === "gallery"}
            onClick={() => setActivePage("gallery")}
          >
            模板广场
          </button>
        </nav>
        <div className={classNames("library-stats", activePage === "gallery" && "visible")}>
          <div>
            <strong>{manifest.count}</strong>
            <span>提示词</span>
          </div>
          <div>
            <strong>{manifest.imageCount}</strong>
            <span>示例图</span>
          </div>
          <div>
            <strong>{favorites.length}</strong>
            <span>收藏</span>
          </div>
        </div>
      </header>
      <main className="workspace">
        {activePage === "workbench" ? (
          <>
            {selectedPrompt ? (
              <section className="hero-strip">
                <div>
                  <p>从模板到成图</p>
                  <h1>{selectedPrompt.title}</h1>
                </div>
                <div className="hero-actions">
                  <button type="button" onClick={() => toggleFavorite(selectedPrompt.id)}>
                    <Heart size={16} />
                    {favorites.includes(selectedPrompt.id) ? "已收藏" : "收藏"}
                  </button>
                  <button type="button" onClick={copyPrompt} disabled={!finalPrompt.trim()}>
                    <Copy size={16} />
                    复制提示词
                  </button>
                  {selectedPrompt.url ? (
                    <a href={selectedPrompt.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      来源
                    </a>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="hero-strip">
                <div>
                  <p>Prompt Studio</p>
                  <h1>生图工作台</h1>
                </div>
              </section>
            )}

            <section className={classNames("editor-layout", !selectedPrompt && "empty-workbench")}>
              <div className="preview-panel">
                {selectedPrompt ? (
                  <>
                    <div className="image-preview">
                      {selectedPrompt.coverImage && canLoadPreviewImage ? (
                        <img
                          src={getImageUrl(selectedPrompt.coverImage)}
                          alt={selectedPrompt.title}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : selectedPrompt.coverImage ? (
                        <div>示例图加载中</div>
                      ) : (
                        <div>暂无示例图</div>
                      )}
                    </div>
                    <p>{selectedPrompt.description}</p>
                    <dl>
                      <div>
                        <dt>作者</dt>
                        <dd>
                          {selectedPrompt.authorLink ? (
                            <a href={selectedPrompt.authorLink} target="_blank" rel="noreferrer">
                              {selectedPrompt.authorName || "未知"}
                            </a>
                          ) : (
                            selectedPrompt.authorName || "未知"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>发布时间</dt>
                        <dd>{formatDate(selectedPrompt.sourcePublishedAt ?? "") || "未知"}</dd>
                      </div>
                      <div>
                        <dt>许可</dt>
                        <dd>CC BY 4.0 / 保留归因</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <div className="template-empty">
                    <span>未选择模板</span>
                  </div>
                )}
              </div>

              <div className="prompt-editor">
                <div className="generator-card main-generator-card">
                  <div className="generator-box">
                    <textarea
                      value={manualPrompt}
                      onChange={(event) => setManualPrompt(event.target.value)}
                      placeholder={isLoadingPrompt ? "正在加载模板..." : "描述你想要生成的图像...（例如：赛博朋克风格的夜晚城市）"}
                      rows={promptLineCount}
                      spellCheck={false}
                    />
                    <div className="generator-tools">
                      <button type="button" onClick={inspireMe} disabled={isLoadingPrompt}>
                        <Sparkles size={15} />
                        灵感
                      </button>
                      <label className="image-tool">
                        <ImagePlus size={15} />
                        添加参考图片
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => {
                            addReferenceImages(event.target.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="inline-settings">
                    <label style={{ "--value-length": model.length } as React.CSSProperties}>
                      模型
                      <input value={model} onChange={(event) => setModel(event.target.value)} />
                    </label>
                    <label style={{ "--value-length": aspectRatio.length } as React.CSSProperties}>
                      画幅
                      <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                        {aspectRatios.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ "--value-length": quality.length } as React.CSSProperties}>
                      质量
                      <select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                        {qualities.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="side-generate-button"
                      type="button"
                      onClick={generateImage}
                      disabled={isGenerating || isLoadingPrompt || !finalPrompt.trim()}
                    >
                      <Check size={24} />
                      {isLoadingPrompt ? "加载中" : isGenerating ? "生成中" : "生成"}
                    </button>
                  </div>

                  {referenceImages.length > 0 ? (
                    <div className="reference-grid">
                      {referenceImages.map((image, index) => (
                        <div className="reference-item" key={image}>
                          <img src={image} alt={`参考图 ${index + 1}`} />
                          <button
                            type="button"
                            aria-label="移除参考图"
                            onClick={() =>
                              setReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
                              }
                            >
                              <X size={14} />
                            </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {error ? <p className="error">{error}</p> : null}
                </div>

                <div className="panel-section result-section">
                  <h2>预览</h2>
                  {selectedResult ? (
                    <>
                      {!isLocalGeneratedImage(selectedResult.imageUrl) || failedResultImageSet.has(selectedResult.imageUrl) ? (
                        <div className="result-preview result-preview-failed">
                          <strong>图片加载失败</strong>
                          <span>这个结果地址不可用，请重新生成一次。</span>
                        </div>
                      ) : (
                        <a className="result-preview" href={selectedResult.imageUrl} target="_blank" rel="noreferrer">
                          <img
                            src={selectedResult.imageUrl}
                            alt="生成结果"
                            onError={() => markResultImageFailed(selectedResult.imageUrl)}
                          />
                        </a>
                      )}
                      <div className="result-actions">
                        <a
                          href={selectedResult.imageUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!isLocalGeneratedImage(selectedResult.imageUrl)}
                        >
                          打开大图
                        </a>
                        <a href={selectedResult.imageUrl} download aria-disabled={!isLocalGeneratedImage(selectedResult.imageUrl)}>
                          下载
                        </a>
                      </div>
                      {selectedResult.filePath ? <p className="file-path">{selectedResult.filePath}</p> : null}
                    </>
                  ) : (
                    <p className="empty">生成后会显示大图预览</p>
                  )}
                </div>

                <div className="panel-section history-section">
                  <h2>历史</h2>
                  <div className="history-list">
                    {history.length ? (
                      history.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={classNames("history-card", selectedResult?.id === item.id && "active")}
                          onClick={() => setSelectedResultId(item.id)}
                        >
                          {failedResultImageSet.has(item.imageUrl) ? (
                            <span className="history-image-failed">加载失败</span>
                          ) : (
                            <img src={item.imageUrl} alt="" onError={() => markResultImageFailed(item.imageUrl)} />
                          )}
                          <small>{formatDate(item.createdAt)}</small>
                          {failedResultImageSet.has(item.imageUrl) ? (
                            <span className="history-remove" onClick={(event) => {
                              event.stopPropagation();
                              removeFailedResult(item.id);
                            }}>
                              移除
                            </span>
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <p className="empty">还没有生成记录</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="template-gallery-section standalone-gallery">
            {renderFilterPanel()}
            <div className="gallery-head">
              <div>
                <p>模板广场</p>
                <h2>按需求找提示词</h2>
              </div>
              <div className="gallery-count">
                <span>当前显示 {galleryStart}-{galleryEnd} 个</span>
                <strong>共 {filteredPromptMatches.length} 个</strong>
              </div>
            </div>

            <div className="gallery-filters">
              <label className="search-control">
                搜索模板
                <input
                  className="gallery-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="头像、海报、产品图、像素风..."
                />
              </label>
              <label>
                语言
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  {languages.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-pressed={featuredOnly}
                onClick={() => setFeaturedOnly((value) => !value)}
              >
                精选
              </button>
              <button
                type="button"
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly((value) => !value)}
              >
                我的收藏
              </button>
              <button
                type="button"
                className="open-filter-button"
                aria-pressed={selectedFilterIds.length > 0}
                onClick={() => setIsFilterPanelOpen(true)}
              >
                <SlidersHorizontal size={16} />
                筛选{selectedFilterIds.length ? ` ${selectedFilterIds.length}` : ""}
              </button>
            </div>

            {activeFilterOptions.length ? (
              <div className="selected-filter-row" aria-label="已选筛选">
                {activeFilterOptions.map((option) => (
                  <button type="button" key={option.id} onClick={() => toggleFilterOption(option.id)}>
                    {option.label}
                    <X size={13} />
                  </button>
                ))}
                <button type="button" onClick={() => setSelectedFilterIds([])}>
                  清空
                </button>
              </div>
            ) : null}

            {renderGalleryPagination()}

            {filteredPrompts.length ? (
              <div className="template-masonry">
                {filteredPrompts.map((prompt, index) => {
                  const isFavorite = favorites.includes(prompt.id);
                  const galleryImageUrl = getImageUrl(prompt.thumbnailImage || prompt.coverImage);
                  const shouldLoadGalleryImage =
                    Boolean(galleryImageUrl) && index < galleryImageLimit && !failedGalleryImageSet.has(galleryImageUrl);

                  return (
                    <div
                      key={prompt.id}
                      className={classNames(
                        "template-tile-wrap",
                        selectedPrompt?.id === prompt.id && "active",
                        index % 9 === 1 && "wide",
                        index % 11 === 3 && "tall",
                        index % 13 === 6 && "large",
                      )}
                    >
                      <button
                        type="button"
                        className="template-tile"
                        onClick={() => selectPrompt(prompt)}
                        disabled={isLoadingPrompt}
                      >
                        {shouldLoadGalleryImage ? (
                          <img
                            src={galleryImageUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={() => markGalleryImageFailed(galleryImageUrl)}
                          />
                        ) : (
                          <span className="tile-fallback tile-image-placeholder">
                            <span>{prompt.language}</span>
                            <small>图片稍后加载</small>
                          </span>
                        )}
                        <span className="tile-info">
                          <strong>{prompt.title}</strong>
                          <small>
                            {getPromptMatchedLabel(prompt)}
                            {prompt.featured ? " / 精选" : ""}
                          </small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="tile-favorite-button"
                        aria-label={isFavorite ? "取消收藏模板" : "收藏模板"}
                        aria-pressed={isFavorite}
                        onClick={() => toggleFavorite(prompt.id)}
                      >
                        <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="gallery-empty">
                <strong>{favoritesOnly ? "还没有收藏模板" : "没有找到匹配模板"}</strong>
                <span>{favoritesOnly ? "看到喜欢的模板时点右上角爱心，下次就能从这里快速找到。" : "换个关键词或分类再试试。"}</span>
              </div>
            )}

            {renderGalleryPagination()}
          </section>
        )}
      </main>
    </div>
  );
}
