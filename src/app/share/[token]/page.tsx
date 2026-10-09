import ShareGridClient from "@/components/ShareGridClient";
import { isValidShareToken } from "@/lib/share-token";
import { getShareStore } from "@/lib/share-store";
import type { GridResult } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isValidShareToken(token)) return <UnavailableShare />;
  try {
    const snapshot = await getShareStore().get(token);
    if (!snapshot) return <UnavailableShare />;
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Salt-okunur grid paylaşımı
        </p>
        <ShareGridClient
          brand={{ id: "shared-brand", ...snapshot.brand }}
          result={gridResultFromSnapshot(snapshot.cells)}
        />
      </main>
    );
  } catch (error) {
    const step = "get_snapshot";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Bilinmeyen hata";
    console.error("[share-api]", { step, errorName, error: errorMessage });
    return <UnavailableShare />;
  }
}

function gridResultFromSnapshot(
  cells: Array<{
    id: string;
    source: "mevcut" | "planlanan";
    imageUrl: string;
    alt?: string;
    position: number;
    row: number;
    column: number;
    pinned: boolean;
    postType?: "post" | "reel" | "carousel";
    caption?: string;
    mediaType?: "image" | "video";
    videoUrl?: string;
    coverImageUrl?: string;
    externalUrl?: string;
  }>,
): GridResult {
  const ordered = [...cells].sort((a, b) => a.position - b.position);
  return {
    cells: ordered.map((cell) => ({
      position: cell.position,
      row: cell.row,
      column: cell.column,
      pinned: cell.pinned,
      post:
        cell.source === "mevcut"
          ? {
              id: cell.id,
              source: "mevcut",
              imageUrl: cell.imageUrl,
              alt: cell.alt,
              recencyIndex: cell.position,
              pinned: cell.pinned,
              postType: cell.postType ?? "post",
              caption: cell.caption,
              mediaType: cell.mediaType,
              videoUrl: cell.videoUrl,
              coverImageUrl: cell.coverImageUrl,
              externalUrl: cell.externalUrl,
            }
          : {
              id: cell.id,
              source: "planlanan",
              imageUrl: cell.imageUrl,
              alt: cell.alt,
              planOrder: cell.position,
              postType: cell.postType ?? "post",
              caption: cell.caption,
              mediaType: cell.mediaType,
              videoUrl: cell.videoUrl,
              coverImageUrl: cell.coverImageUrl,
              externalUrl: cell.externalUrl,
            },
    })),
    rowCount: Math.ceil(ordered.length / 3),
    pinnedCount: ordered.filter((cell) => cell.pinned).length,
  };
}

function UnavailableShare() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Paylaşım kullanılamıyor</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Bu paylaşım bağlantısı bulunamadı veya artık kullanılamıyor.
      </p>
    </main>
  );
}
