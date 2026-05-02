export type PromptArgument = {
  key: string;
  defaultValue: string;
};

const argumentPattern =
  /\{argument\s+name=(?:"([^"]+)"|'([^']+)')\s+default=(?:"([^"]*)"|'([^']*)')\}/g;

export function extractArguments(prompt: string): PromptArgument[] {
  const seen = new Set<string>();
  const args: PromptArgument[] = [];
  let match: RegExpExecArray | null;

  while ((match = argumentPattern.exec(prompt)) !== null) {
    const key = match[1] || match[2] || "";
    const defaultValue = match[3] || match[4] || "";

    if (!key || seen.has(key)) continue;
    seen.add(key);
    args.push({ key, defaultValue });
  }

  return args;
}

export function applyArguments(prompt: string, values: Record<string, string>): string {
  return prompt.replace(argumentPattern, (_match, keyA, keyB, defaultA, defaultB) => {
    const key = keyA || keyB || "";
    const defaultValue = defaultA || defaultB || "";
    return values[key]?.trim() || defaultValue;
  });
}
