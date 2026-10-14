import { computeGrid } from "./grid";
import { reorderPinnedPosts, reorderPlannedPosts } from "./post-ops";
import type { ExistingPost, GridCell, PlannedPost } from "./types";

/**
 * Grid sürükle-bırak kuralları.
 *
 * Grid sırası tek kaynaktan türetilir (`computeGrid`): önce sabitlenmiş
 * gönderiler (pinnedOrder), sonra planlananlar (planOrder), sonra mevcut
 * gönderiler (recencyIndex). Bu üç bölge grid üzerinde ardışık durur ve
 * bir içerik yalnız kendi bölgesi içinde taşınabilir:
 *
 * - pinned  ↔ pinned   : izinli (pinnedOrder yeniden yazılır)
 * - planned ↔ planned  : izinli (planOrder yeniden yazılır)
 * - existing ↔ existing: izinli (recencyIndex yeniden yazılır)
 * - bölgeler arası      : engelli. Sabit/normal ayrımı Instagram kuralıdır;
 *   planlanan içerik yayınlanacağı için her zaman mevcutların üstündedir,
 *   bu yüzden planlanan ile mevcut da yer değiştiremez. İçeriğin kaynağı
 *   (mevcut/planlanan) ve sabitlenmesi asla değişmez.
 */
export type GridZone = "pinned" | "planned" | "existing";

export function gridCellZone(cell: Pick<GridCell, "pinned" | "post">): GridZone {
  if (cell.pinned) return "pinned";
  return cell.post.source === "planlanan" ? "planned" : "existing";
}

export function canDropInGridZone(activeZone: GridZone | null | undefined, overZone: GridZone | null | undefined): boolean {
  return Boolean(activeZone) && activeZone === overZone;
}

function moveId(ids: string[], activeId: string, overId: string): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/**
 * `activeId` içeriğini `overId`'nin konumuna taşır. Geçersiz (bölgeler
 * arası, bilinmeyen id veya aynı konum) taşımada `null` döner; çağıran
 * state'i değiştirmez.
 */
export function reorderGridPosts(
  existingPosts: ExistingPost[],
  plannedPosts: PlannedPost[],
  activeId: string,
  overId: string,
): { existingPosts: ExistingPost[]; plannedPosts: PlannedPost[] } | null {
  const { cells } = computeGrid(existingPosts, plannedPosts);
  const active = cells.find((cell) => cell.post.id === activeId);
  const over = cells.find((cell) => cell.post.id === overId);
  if (!active || !over) return null;
  const zone = gridCellZone(active);
  if (!canDropInGridZone(zone, gridCellZone(over))) return null;

  const zoneIds = cells.filter((cell) => gridCellZone(cell) === zone).map((cell) => cell.post.id);
  const ordered = moveId(zoneIds, activeId, overId);
  if (!ordered) return null;

  if (zone === "pinned") {
    return { existingPosts: reorderPinnedPosts(existingPosts, ordered), plannedPosts };
  }
  if (zone === "planned") {
    return { existingPosts, plannedPosts: reorderPlannedPosts(plannedPosts, ordered) };
  }
  // Mevcut bölge: bu gönderilerin halihazırda kullandığı recencyIndex
  // değerleri yeni sıraya yeniden dağıtılır; sabitlenmiş gönderilerin
  // recencyIndex'i ve diğer bölgeler etkilenmez.
  const slots = existingPosts
    .filter((post) => ordered.includes(post.id))
    .map((post) => post.recencyIndex)
    .sort((a, b) => a - b);
  // Eski kayıtlarda tekrar eden değer varsa sıra belirsiz kalmasın.
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  }
  const nextIndex = new Map(ordered.map((id, i) => [id, slots[i]]));
  return {
    existingPosts: existingPosts.map((post) => {
      const recencyIndex = nextIndex.get(post.id);
      return recencyIndex === undefined ? post : { ...post, recencyIndex };
    }),
    plannedPosts,
  };
}
