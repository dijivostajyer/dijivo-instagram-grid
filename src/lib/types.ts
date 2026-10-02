/**
 * Dijivo Instagram Grid Preview Tool — veri modeli (MVP, Faz 1)
 *
 * Not: API anahtarı, token veya parola yoktur; veri yalnızca sunum amaçlıdır.
 */

/** Grid içinde bir hücrenin kaynağı */
export type PostSource = "mevcut" | "planlanan";
export type PostType = "post" | "reel" | "carousel";

export interface Highlight {
  id: string;
  title: string;
  imageUrl?: string;
}

/** Marka bazlı hashtag grubu: caption'a tek tıkla eklenir. */
export interface HashtagGroup {
  id: string;
  /** Grup başlığı (örn. "Genel", "Kampanya") */
  title: string;
  /** # işaretli etiketler (boşlukla ayrılmış tek string de olabilir) */
  tags: string[];
}

export interface Brand {
  /** Kısa benzersiz tanımlayıcı (slug) */
  id: string;
  /** Görüntülenen marka adı */
  name: string;
  /** Instagram kullanıcı adı (@ işareti olmadan) */
  username: string;
  /** Instagram'da görüntülenen görünen ad (isteğe bağlı; yoksa name kullanılır) */
  displayName?: string;
  /** Profil görselinin URL'si (isteğe bağlı) */
  profileImageUrl?: string;
  /** Kısa açıklama (isteğe bağlı) */
  bio?: string;
  /** Profil web sitesi (isteğe bağlı) */
  website?: string;
  /** Ajans iletişim alanları (isteğe bağlı) */
  phone?: string;
  email?: string;
  category?: string;
  /** Görüntülenen profil istatistikleri (isteğe bağlı). */
  postCount?: number;
  followersCount?: number;
  followingCount?: number;
  highlights?: Highlight[];
  /** Marka bazlı hashtag grupları (isteğe bağlı) */
  hashtagGroups?: HashtagGroup[];
  /** Hazır @mention'lar (isteğe bağlı) */
  defaultMentions?: string[];
  /** Hazır CTA şablonları (isteğe bağlı) */
  defaultCtas?: string[];
}

export interface Post {
  /** Benzersiz gönderi kimliği */
  id: string;
  /** Görselin URL'si */
  imageUrl: string;
  /** Erişilebilirlik için alternatif metin */
  alt?: string;
  /** Instagram 1:1 kırpmadan önceki görsel oranı */
  aspectRatio?: "1:1" | "3:4" | "4:3" | "16:9";
  /** İçerik formatı; eski kayıtlar varsayılan olarak normal gönderidir. */
  postType?: PostType;
  /** Gönderi açıklaması (caption); hashtag/mention içerebilir. */
  caption?: string;
  /**
   * Medya türü; reel'ler için video desteği (Phase 2, §4).
   * Eski kayıtlar ve görsel gönderiler için tanımsız = image.
   */
  mediaType?: "image" | "video";
  /** Reel videosu URL'si (mediaType: "video" ise). */
  videoUrl?: string;
  /** Reel kapak görseli URL'si (video yerine grid'de gösterilir). */
  coverImageUrl?: string;
}

/** Instagram'da halihazırda yayında olan gönderi */
export interface ExistingPost extends Post {
  source: "mevcut";
  /**
   * Yayın sırası: 0 = en yeni gönderi.
   * Grid'de "en yeni üst solda" kuralı bu sıraya göre hesaplanır.
   */
  recencyIndex: number;
  /** Profilin üstünde sabitlenmiş mi? */
  pinned: boolean;
  /**
   * Pinned sırası (0–2): üst satırda soldan sağa konum.
   * Yalnızca `pinned: true` iken anlamlıdır.
   */
  pinnedOrder?: number;
}

/** Henüz yayınlanmamış, planlanan gönderi */
export interface PlannedPost extends Post {
  source: "planlanan";
  /**
   * Plan sırası: 0 = ilk yayınlanacak (yani gridde en üstte görünecek) gönderi.
   * Yeni planlanan içerik mevcut gridin üstüne eklenir (handoff §5).
   */
  planOrder: number;
  /** Planlanan gönderiler pinned olamaz; alan MVP'de yoktur. */
}

export type AnyPost = ExistingPost | PlannedPost;

/** Hesaplanmış grid hücresi */
export interface GridCell {
  post: AnyPost;
  /** Griddeki satır (0 = üst) */
  row: number;
  /** Griddeki sütun (0–2) */
  column: number;
  /** Satır içindeki düz konum (0'dan itibaren) */
  position: number;
  /** Sabitlenmiş gönderi mi? */
  pinned: boolean;
}

/** Marka + gönderilerden hesaplanan grid sonucu */
export interface GridResult {
  /** Okunur sıra: index = grid konumu */
  cells: GridCell[];
  /** Satır sayısı */
  rowCount: number;
  /** Sabitlenmiş gönderi sayısı (3 ile sınırlı kullanılır) */
  pinnedCount: number;
}
