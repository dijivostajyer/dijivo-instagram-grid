/**
 * Dijivo Instagram Grid Preview Tool — veri modeli (MVP, Faz 1)
 *
 * Not: API anahtarı, token veya parola yoktur; veri yalnızca sunum amaçlıdır.
 */

/** Grid içinde bir hücrenin kaynağı */
export type PostSource = "mevcut" | "planlanan";

export interface Brand {
  /** Kısa benzersiz tanımlayıcı (slug) */
  id: string;
  /** Görüntülenen marka adı */
  name: string;
  /** Instagram kullanıcı adı (@ işareti olmadan) */
  username: string;
  /** Profil görselinin URL'si (isteğe bağlı) */
  profileImageUrl?: string;
  /** Kısa açıklama (isteğe bağlı) */
  bio?: string;
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
