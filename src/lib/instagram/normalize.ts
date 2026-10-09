/**
 * Instagram URL parsing ve username extraction.
 */

export interface ParseInstagramUrlResult {
  ok: boolean;
  username?: string;
  error?: string;
}

/**
 * Instagram profil URL'sinden username'i çıkarır.
 * Desteklenen formatlar:
 * - https://instagram.com/username
 * - https://instagram.com/username/
 * - https://www.instagram.com/username
 * - https://www.instagram.com/username/
 * - instagram.com/username
 * - www.instagram.com/username
 *
 * Desteklenmeyen formatlar:
 * - @username (doğrudan string)
 * - https://instagram.com/p/... (post URL)
 * - https://instagram.com/reel/... (reel URL)
 */
export function parseInstagramUrl(url: string): ParseInstagramUrlResult {
  if (!url || typeof url !== "string") {
    return { ok: false, error: "Geçersiz URL" };
  }

  const trimmed = url.trim();

  // @username formatı desteklenmiyor
  if (trimmed.startsWith("@")) {
    return { ok: false, error: "Kullanıcı adını URL formatında girin (örn. https://instagram.com/kullaniciadi)" };
  }

  // URL'yi normalize et
  let normalized = trimmed;
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }

  try {
    const urlObj = new URL(normalized);

    // Instagram domain kontrolü
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname !== "instagram.com" && hostname !== "www.instagram.com") {
      return { ok: false, error: "Geçerli bir Instagram profil bağlantısı girin." };
    }

    // Path kontrolü - post/reel URL'leri kabul edilmez
    const path = urlObj.pathname.toLowerCase();
    if (path.startsWith("/p/") || path.startsWith("/reel/")) {
      return { ok: false, error: "Gönderi veya reel URL'leri yerine profil URL'si girin." };
    }

    // Username'i path'ten çıkar
    // /username veya /username/ formatı
    const pathParts = path.split("/").filter(Boolean);
    if (pathParts.length !== 1) {
      return { ok: false, error: "Geçersiz Instagram profil bağlantısı." };
    }

    const username = pathParts[0];

    // Username validasyonu
    if (!username || !/^[a-zA-Z0-9._-]+$/.test(username)) {
      return { ok: false, error: "Geçersiz kullanıcı adı." };
    }

    return { ok: true, username };
  } catch (error) {
    return { ok: false, error: "Geçersiz URL formatı." };
  }
}

/** Provider çıktısını UI'a giden küçük, güvenli ve isteğe bağlı alanlara indirger. */
export function normalizeInstagramProfile(profile: import("./types").InstagramProfile): import("./types").InstagramProfile {
  const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const optionalCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  const optionalHttpUrl = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    username: profile.username.trim().replace(/^@/, ""),
    displayName: optionalText(profile.displayName),
    biography: optionalText(profile.biography),
    profileImageUrl: optionalHttpUrl(profile.profileImageUrl),
    followersCount: optionalCount(profile.followersCount),
    followingCount: optionalCount(profile.followingCount),
    postsCount: optionalCount(profile.postsCount),
    isPrivate: profile.isPrivate === true,
    isVerified: profile.isVerified === true,
    recentPosts: (profile.recentPosts ?? []).flatMap((post) => {
      const thumbnailUrl = optionalHttpUrl(post.thumbnailUrl);
      const mediaUrl = optionalHttpUrl(post.mediaUrl);
      if (!post.id || !thumbnailUrl) return [];
      return [{ id: String(post.id), type: post.type, thumbnailUrl, mediaUrl, caption: optionalText(post.caption), postedAt: optionalText(post.postedAt) }];
    }),
    highlights: (profile.highlights ?? []).flatMap((highlight) => {
      if (!highlight.id || !optionalText(highlight.title)) return [];
      return [{ id: String(highlight.id), title: optionalText(highlight.title)!, coverUrl: optionalHttpUrl(highlight.coverUrl) }];
    }),
  };
}
