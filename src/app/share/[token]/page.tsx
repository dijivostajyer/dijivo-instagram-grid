import GridPreview from "@/components/GridPreview";
import { isValidShareToken } from "@/lib/share-token";
import { shareStore } from "@/lib/share-store";
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
    const snapshot = await shareStore.get(token);
    if (!snapshot) return <UnavailableShare />;
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Salt-okunur grid paylaşımı
        </p>
        <div className="rounded-lg border border-neutral-200 p-4">
          <GridPreview
            brand={{ id: "shared-brand", ...snapshot.brand }}
            result={gridResultFromSnapshot(snapshot.cells)}
          />
        </div>
      </main>
    );
  } catch (error) {
    console.error("[share] Snapshot okunamadı:", error);
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
            }
          : {
              id: cell.id,
              source: "planlanan",
              imageUrl: cell.imageUrl,
              alt: cell.alt,
              planOrder: cell.position,
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
