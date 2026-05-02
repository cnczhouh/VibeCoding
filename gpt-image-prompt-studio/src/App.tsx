import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Heart, ImagePlus, Sparkles, X } from "lucide-react";
import { applyArguments, extractArguments } from "./promptArguments";
import { readStorage, writeStorage } from "./storage";
import type { ImageResult, PromptItem } from "./types";

const languages = ["全部", "zh", "en", "ja", "ko"];
const aspectRatios = ["auto", "1:1", "16:9", "9:16"] as const;
const qualities = ["auto", "low", "medium", "high"] as const;
const categories = [
  {
    id: "all",
    label: "全部",
    keywords: [],
  },
  {
    id: "avatar",
    label: "头像",
    keywords: ["头像", "avatar", "portrait", "headshot", "profile", "肖像", "证件照"],
  },
  {
    id: "poster",
    label: "海报",
    keywords: ["海报", "poster", "广告", "ad ", "advertisement", "宣传", "banner", "封面", "cover"],
  },
  {
    id: "product",
    label: "产品图",
    keywords: ["产品", "product", "商品", "包装", "packaging", "电商", "爆炸视图", "exploded"],
  },
  {
    id: "ui",
    label: "UI 界面",
    keywords: ["ui", "app", "web", "dashboard", "界面", "网页", "网站", "screen", "screenshot"],
  },
  {
    id: "illustration",
    label: "插画",
    keywords: ["插画", "illustration", "绘本", "手绘", "水彩", "漫画", "cartoon", "anime"],
  },
  {
    id: "photo",
    label: "摄影",
    keywords: ["摄影", "photo", "photography", "cinematic", "电影感", "镜头", "写实", "realistic"],
  },
  {
    id: "character",
    label: "角色",
    keywords: ["角色", "character", "人物", "mascot", "ip", "cosplay", "anime character"],
  },
  {
    id: "map",
    label: "地图 / 信息图",
    keywords: ["地图", "map", "信息图", "infographic", "diagram", "图解", "chart", "流程图"],
  },
  {
    id: "typography",
    label: "文字排版",
    keywords: ["文字", "typography", "排版", "字体", "logo", "标志", "lettering", "slides", "ppt"],
  },
  {
    id: "style",
    label: "风格化",
    keywords: ["风格", "style", "滤镜", "半色调", "halftone", "像素", "pixel", "复古", "retro"],
  },
  {
    id: "space",
    label: "建筑 / 空间",
    keywords: ["建筑", "空间", "室内", "interior", "architecture", "房间", "店铺", "展厅", "景观"],
  },
  {
    id: "other",
    label: "其他",
    keywords: [],
  },
] as const;

type CategoryId = (typeof categories)[number]["id"];

type AspectRatio = (typeof aspectRatios)[number];
type Quality = (typeof qualities)[number];
type Page = "workbench" | "gallery";
const galleryPageSize = 20;
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

function getPromptCategory(prompt: PromptItem): CategoryId {
  const searchText = `${prompt.title}\n${prompt.description}\n${prompt.searchText ?? ""}`.toLowerCase();
  const matchedCategory = categories.find((category) =>
    category.id !== "all" &&
    category.id !== "other" &&
    category.keywords.some((keyword) => searchText.includes(keyword.toLowerCase())),
  );

  return matchedCategory?.id ?? "other";
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
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");
  const [activePage, setActivePage] = useState<Page>("workbench");
  const [galleryPage, setGalleryPage] = useState(1);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptItem | null>(null);
  const [argumentValues, setArgumentValues] = useState<Record<string, string>>({});
  const [manualPrompt, setManualPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [quality, setQuality] = useState<Quality>("auto");
  const [model, setModel] = useState("gpt-image-2");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<number[]>(() => readStorage("promptStudio:favorites", []));
  const [history, setHistory] = useState<ImageResult[]>(() => readStorage("promptStudio:history", []));
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

  const filteredPromptMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return prompts
      .map((prompt) => ({ prompt, score: rankPrompt(prompt, normalizedQuery) }))
      .filter(({ prompt, score }) => {
        if (activeCategory !== "all" && getPromptCategory(prompt) !== activeCategory) return false;
        if (featuredOnly && !prompt.featured) return false;
        if (favoritesOnly && !favorites.includes(prompt.id)) return false;
        if (language !== "全部" && prompt.language !== language) return false;
        if (normalizedQuery && score <= 0) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score || Number(b.prompt.featured) - Number(a.prompt.featured))
      .map(({ prompt }) => prompt);
  }, [activeCategory, favorites, favoritesOnly, featuredOnly, language, prompts, query]);
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
  }, [activeCategory, favoritesOnly, featuredOnly, language, query]);

  useEffect(() => {
    setGalleryPage((current) => Math.min(current, galleryPageCount));
  }, [galleryPageCount]);

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

  function selectCategory(categoryId: CategoryId) {
    setActiveCategory(categoryId);
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
        imageUrl: data.imageUrl,
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
          <strong>GPT生图系统V1.0</strong>
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
        <div className="library-stats">
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

            <section className="editor-layout">
              <div className="preview-panel">
                {selectedPrompt ? (
                  <>
                    <div className="image-preview">
                      {selectedPrompt.coverImage ? (
                        <img
                          src={getImageUrl(selectedPrompt.coverImage)}
                          alt={selectedPrompt.title}
                          decoding="async"
                        />
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
                    <button
                      className="side-generate-button"
                      type="button"
                      onClick={generateImage}
                      disabled={isGenerating || isLoadingPrompt || !finalPrompt.trim()}
                    >
                      <Check size={30} />
                      {isLoadingPrompt ? "加载中" : isGenerating ? "生成中" : "生成"}
                    </button>
                  </div>

                  <div className="inline-settings">
                    <label>
                      模型
                      <input value={model} onChange={(event) => setModel(event.target.value)} />
                    </label>
                    <label>
                      画幅
                      <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                        {aspectRatios.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      质量
                      <select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                        {qualities.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
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
                      <a className="result-preview" href={selectedResult.imageUrl} target="_blank" rel="noreferrer">
                        <img src={selectedResult.imageUrl} alt="生成结果" />
                      </a>
                      <div className="result-actions">
                        <a href={selectedResult.imageUrl} target="_blank" rel="noreferrer">
                          打开大图
                        </a>
                        <a href={selectedResult.imageUrl} download>
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
                          <img src={item.imageUrl} alt="" />
                          <small>{formatDate(item.createdAt)}</small>
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
            <div className="gallery-head">
              <div>
                <p>模板广场</p>
                <h2>按分类找提示词</h2>
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
            </div>

            <div className="category-row">
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  aria-pressed={activeCategory === category.id}
                  onClick={() => selectCategory(category.id)}
                >
                  {category.label}
                </button>
              ))}
            </div>

            {renderGalleryPagination()}

            {filteredPrompts.length ? (
              <div className="template-masonry">
                {filteredPrompts.map((prompt, index) => {
                  const isFavorite = favorites.includes(prompt.id);

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
                        {prompt.coverImage ? (
                          <img src={getImageUrl(prompt.coverImage)} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <span className="tile-fallback">{prompt.language}</span>
                        )}
                        <span className="tile-info">
                          <strong>{prompt.title}</strong>
                          <small>
                            {categories.find((category) => category.id === getPromptCategory(prompt))?.label}
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
