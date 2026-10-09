/**
 * Reel kaynaklarını güvenli biçimde ayırır. Instagram gönderi/permalink
 * adresleri oynatılabilir medya değildir; bunlar yalnızca dış bağlantı
 * fallback'i olarak tutulur.
 */
export function isInstagramPostUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      /(^|\.)instagram\.com$/i.test(url.hostname) &&
      /^(?:\/(?:p|reel|tv)\/)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Browser'ın video etiketiyle doğrudan açabileceği bilinen URL şekilleri.
 * Bir Instagram permalink'i hiçbir zaman video kaynağı kabul edilmez.
 */
export function isPlayableVideoUrl(value: string | undefined): value is string {
  if (!value || isInstagramPostUrl(value)) return false;
  if (
    value.startsWith("blob:") ||
    value.startsWith("data:video/") ||
    value.startsWith("storage:workspace-media/") ||
    value.startsWith("storage:media/")
  ) {
    return true;
  }
  if (!isHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    return /\.(?:mp4|webm|m4v|mov)(?:$|[?#])/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}
