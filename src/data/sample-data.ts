import type { Brand, ExistingPost, PlannedPost } from "@/lib/types";

/**
 * Örnek demo verisi (MVP Faz 1). Gerçek müşteri verisi içermez;
 * görseller placeholder.com servisinden gelir.
 */
export const SAMPLE_BRAND: Brand = {
  id: "dijivo-demo",
  name: "Dijivo Demo Marka",
  username: "dijivo.demo",
  profileImageUrl: "https://placehold.co/150x150/111827/ffffff?text=D",
  bio: "Dijivo grid önizleme aracı demo profili",
};

export const SAMPLE_EXISTING_POSTS: ExistingPost[] = [
  {
    id: "mevcut-1",
    source: "mevcut",
    recencyIndex: 0,
    pinned: true,
    pinnedOrder: 0,
    imageUrl:
      "https://placehold.co/600x750/4f46e5/ffffff?text=Mevcut+1+(pinned)",
    alt: "Pinned gönderi 1",
    aspectRatio: "3:4",
  },
  {
    id: "mevcut-2",
    source: "mevcut",
    recencyIndex: 1,
    pinned: true,
    pinnedOrder: 1,
    imageUrl: "https://placehold.co/600x600/7c3aed/ffffff?text=Mevcut+2",
    alt: "Pinned gönderi 2",
    aspectRatio: "1:1",
  },
  {
    id: "mevcut-3",
    source: "mevcut",
    recencyIndex: 2,
    pinned: false,
    imageUrl: "https://placehold.co/600x450/a855f7/ffffff?text=Mevcut+3",
    alt: "Mevcut gönderi 3",
    aspectRatio: "4:3",
  },
  {
    id: "mevcut-4",
    source: "mevcut",
    recencyIndex: 3,
    pinned: false,
    imageUrl: "https://placehold.co/600x600/ec4899/ffffff?text=Mevcut+4",
    alt: "Mevcut gönderi 4",
    aspectRatio: "1:1",
  },
  {
    id: "mevcut-5",
    source: "mevcut",
    recencyIndex: 4,
    pinned: false,
    imageUrl: "https://placehold.co/600x600/f43f5e/ffffff?text=Mevcut+5",
    alt: "Mevcut gönderi 5",
    aspectRatio: "1:1",
  },
];

export const SAMPLE_PLANNED_POSTS: PlannedPost[] = [
  {
    id: "plan-1",
    source: "planlanan",
    planOrder: 0,
    imageUrl:
      "https://placehold.co/600x800/0ea5e9/ffffff?text=Plan+1+(ilk+yayın)",
    alt: "Planlanan gönderi 1",
    aspectRatio: "3:4",
  },
  {
    id: "plan-2",
    source: "planlanan",
    planOrder: 1,
    imageUrl: "https://placehold.co/600x600/06b6d4/ffffff?text=Plan+2",
    alt: "Planlanan gönderi 2",
    aspectRatio: "1:1",
  },
  {
    id: "plan-3",
    source: "planlanan",
    planOrder: 2,
    imageUrl: "https://placehold.co/600x600/14b8a6/ffffff?text=Plan+3",
    alt: "Planlanan gönderi 3",
    aspectRatio: "1:1",
  },
];
