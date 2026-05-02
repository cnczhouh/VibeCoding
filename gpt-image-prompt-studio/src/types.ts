export type PromptItem = {
  id: number;
  title: string;
  description: string;
  prompt?: string;
  originalPrompt?: string;
  language: string;
  slug?: string;
  url?: string;
  sourceLink?: string;
  sourcePublishedAt?: string;
  sourcePlatform?: string;
  authorName?: string;
  authorLink?: string;
  coverImage?: string;
  images?: string[];
  featured: boolean;
  needReferenceImages?: boolean;
  searchText?: string;
};

export type ImageResult = {
  id: string;
  prompt: string;
  imageUrl: string;
  filePath?: string;
  createdAt: string;
};
