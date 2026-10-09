/**
 * Instagram veri sağlayıcıları için normalize edilmiş veri tipleri.
 * Her provider farklı alanlar sağlayabilir; null/undefined desteklenir.
 */

export interface InstagramPost {
  id: string;
  type: "post" | "carousel" | "reel" | "unknown";
  thumbnailUrl?: string;
  mediaUrl?: string;
  caption?: string;
  postedAt?: string;
}

export interface InstagramHighlight {
  id: string;
  title: string;
  coverUrl?: string;
}

export interface InstagramProfile {
  username: string;
  displayName?: string;
  biography?: string;
  profileImageUrl?: string;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  isPrivate?: boolean;
  isVerified?: boolean;
  recentPosts?: InstagramPost[];
  highlights?: InstagramHighlight[];
}

export interface InstagramProviderConfig {
  provider: string;
  apiKey?: string;
}

export interface InstagramProviderResult {
  ok: boolean;
  profile?: InstagramProfile;
  warnings?: string[];
}

export interface InstagramProvider {
  fetchProfile(username: string): Promise<InstagramProviderResult>;
  fetchRecentPosts(username: string): Promise<InstagramPost[]>;
}
