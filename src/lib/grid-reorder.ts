import { computeGrid } from "./grid";
import { reorderPinnedPosts } from "./post-ops";
import type { ExistingPost, GridCell, PlannedPost } from "./types";

/**
 * Grid sürükle-bırak kuralları.
 *
 * Grid sırası tek kaynaktan türetilir (`computeGrid`): önce sabitlenmiş
 * gönderiler (pinnedOrder), sonra sabitlenmemiş tüm içerikler tek ortak
 * sırada (gridOrder; planlanan + mevcut karışık olabilir). İki bölge vardır:
 *
 * - pinned ↔ pinned : izinli (pinnedOrder yeniden yazılır)
 * - normal ↔ normal : izinli; planlanan ↔ mevcut dahil (gridOrder yazılır)
 * - pinned ↔ normal : engelli (Instagram sabitleme kuralı)
 *
 * İçeriğin kaynağı (mevcut/planlanan), dizisi, pin durumu ve medyası asla
 * değişmez; yalnız sıra alanları yeniden yazılır.
 */
export type GridZone = "pinned" | "normal";

export function gridCellZone(cell: Pick<GridCell, "pinned">): GridZone {
  return cell.pinned ? "pinned" : "normal";
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
 * Sabitlenmemiş içeriklerin yeni ortak sırasını yazar: her içeriğe
 * gridOrder verilir. Kaynağa özgü sıralar da tutarlı tutulur (yan paneldeki
 * listeler ve eski kurala dönüş için): planlananların planOrder'ı ve
 * mevcutların recencyIndex'i kendi aralarındaki yeni göreli sıraya göre.
 */
export function applyNormalOrder(
  existingPosts: ExistingPost[],
  plannedPosts: PlannedPost[],
  orderedIds: string[],
): { existingPosts: ExistingPost[]; plannedPosts: PlannedPost[] } {
  const gridIndex = new Map(orderedIds.map((id, index) => [id, index]));

  const plannedIds = new Set(plannedPosts.map((post) => post.id));
  const planOrder = new Map(orderedIds.filter((id) => plannedIds.has(id)).map((id, index) => [id, index]));

  // Mevcutların halihazırda kullandığı recencyIndex değerleri yeni göreli
  // sıraya dağıtılır; sabitlenmiş gönderilerin recencyIndex'i değişmez.
  const orderedExisting = orderedIds.filter((id) => existingPosts.some((post) => post.id === id));
  const slots = existingPosts
    .filter((post) => orderedExisting.includes(post.id))
    .map((post) => post.recencyIndex)
    .sort((a, b) => a - b);
  // Eski kayıtlarda tekrar eden değer varsa sıra belirsiz kalmasın.
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  }
  const recency = new Map(orderedExisting.map((id, index) => [id, slots[index]]));

  return {
    existingPosts: existingPosts.map((post) => {
      const gridOrder = gridIndex.get(post.id);
      if (gridOrder === undefined) return post;
      return { ...post, gridOrder, recencyIndex: recency.get(post.id) ?? post.recencyIndex };
    }),
    plannedPosts: plannedPosts.map((post) => {
      const gridOrder = gridIndex.get(post.id);
      if (gridOrder === undefined) return post;
      return { ...post, gridOrder, planOrder: planOrder.get(post.id) ?? post.planOrder };
    }),
  };
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
  return applyNormalOrder(existingPosts, plannedPosts, ordered);
}

/**
 * Yan paneldeki "Planlanan" listesinden yapılan sıralama: planlananlar
 * gridde şu an kapladıkları konumlara yeni sırayla yerleşir; mevcut
 * içeriklerin konumu değişmez. Geçersiz liste (eksik/fazla id) → null.
 */
export function reorderPlannedInGrid(
  existingPosts: ExistingPost[],
  plannedPosts: PlannedPost[],
  orderedPlannedIds: string[],
): { existingPosts: ExistingPost[]; plannedPosts: PlannedPost[] } | null {
  const plannedIds = new Set(plannedPosts.map((post) => post.id));
  if (orderedPlannedIds.length !== plannedIds.size || !orderedPlannedIds.every((id) => plannedIds.has(id))) return null;
  const normalIds = computeGrid(existingPosts, plannedPosts).cells
    .filter((cell) => gridCellZone(cell) === "normal")
    .map((cell) => cell.post.id);
  let next = 0;
  const ordered = normalIds.map((id) => (plannedIds.has(id) ? orderedPlannedIds[next++] : id));
  return applyNormalOrder(existingPosts, plannedPosts, ordered);
}
