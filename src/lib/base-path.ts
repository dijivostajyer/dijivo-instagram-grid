const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const normalizedBasePath = configuredBasePath.replace(/^\/+|\/+$/g, "");

/** `/grid/` gibi bir env değeri verilse bile tek, başında slash olan path. */
export const BASE_PATH = normalizedBasePath
  ? `/${normalizedBasePath}`
  : "";

export function withBasePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
