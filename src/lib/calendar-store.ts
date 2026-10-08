import type {
  CalendarItem,
  CalendarItemRow,
  CalendarItemType,
  CalendarStatus,
  ChecklistItem,
} from "./calendar-types";
import { randomId } from "./calendar-utils";

/**
 * Yerel takvim depolama (Supabase yoksa fallback, §22).
 *
 * Arayüz, API katmanıyla (src/app/api/calendar/*) birebir
 * aynıdır; hook hangi katmanı kullandığını bilmez.
 * Marka/proje izolasyonu (§23/§24) burada da zorunludur:
 * cross-brand postId reddedilir.
 */

export const CALENDAR_STORAGE_KEY = "dijivo-calendar-items";

export interface CalendarStoreLike {
  list(brandId: string, projectId: string): Promise<CalendarItem[]>;
  listAll(brandId: string): Promise<CalendarItem[]>;
  create(input: CalendarItemInput): Promise<CalendarItem>;
  update(
    id: string,
    patch: CalendarPatch,
    brandId: string,
  ): Promise<CalendarItem>;
  remove(id: string, brandId: string): Promise<void>;
}

export interface CalendarItemInput {
  brandId: string;
  projectId: string;
  postId: string | null;
  itemType: CalendarItemType;
  title: string;
  description: string;
  scheduledAt: string;
  status: CalendarStatus;
  checklist: ChecklistItem[];
}

export interface CalendarPatch {
  postId?: string | null;
  itemType?: CalendarItemType;
  title?: string;
  description?: string;
  scheduledAt?: string;
  status?: CalendarStatus;
  checklist?: ChecklistItem[];
}

/** Marka dışı kayıt erişimi (§23/§37: çarpma değil, açık hata). */
export class CalendarAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarAccessError";
  }
}

function rowToItem(row: CalendarItemRow): CalendarItem {
  return {
    id: row.id,
    brandId: row.brand_id,
    projectId: row.project_id,
    postId: row.post_id,
    itemType: row.item_type,
    title: row.title,
    description: row.description,
    scheduledAt: row.scheduled_at,
    status: row.status,
    checklist: row.checklist ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemToRow(item: CalendarItem): CalendarItemRow {
  return {
    id: item.id,
    brand_id: item.brandId,
    project_id: item.projectId,
    post_id: item.postId,
    item_type: item.itemType,
    title: item.title,
    description: item.description,
    scheduled_at: item.scheduledAt,
    status: item.status,
    checklist: item.checklist,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function readRows<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeRows<T>(key: string, rows: T[]): void {
  window.localStorage.setItem(key, JSON.stringify(rows));
}

/**
 * localStorage destekli takvim depolama. Üretimde
 * Supabase API katmanı tercih edilir; bu sınıf
 * yedek ve test ortamıdır.
 */
export class LocalCalendarStore {
  constructor(
    private readonly itemsKey = CALENDAR_STORAGE_KEY,
    private readonly now = () => new Date(),
  ) {}

  private readItems(): CalendarItemRow[] {
    return readRows<CalendarItemRow>(this.itemsKey);
  }

  private writeItems(rows: CalendarItemRow[]): void {
    writeRows(this.itemsKey, rows);
  }

  async list(brandId: string, projectId: string): Promise<CalendarItem[]> {
    // §23/§24: sorgu her zaman brand + project filtresiyle gelir.
    return this.readItems()
      .filter(
        (row) => row.brand_id === brandId && row.project_id === projectId,
      )
      .map(rowToItem);
  }

  async listAll(brandId: string): Promise<CalendarItem[]> {
    return this.readItems()
      .filter((row) => row.brand_id === brandId)
      .map(rowToItem);
  }

  async create(input: CalendarItemInput): Promise<CalendarItem> {
    const timestamp = this.now().toISOString();
    const item: CalendarItem = {
      ...input,
      id: randomId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeItems([...this.readItems(), itemToRow(item)]);
    return item;
  }

  async update(
    id: string,
    patch: CalendarPatch,
    brandId: string,
  ): Promise<CalendarItem> {
    const rows = this.readItems();
    const index = rows.findIndex(
      (row) => row.id === id && row.brand_id === brandId,
    );
    if (index === -1) {
      throw new CalendarAccessError("Takvim kaydı bulunamadı.");
    }
    const merged: CalendarItemRow = {
      ...rows[index],
      ...{
        post_id: patch.postId ?? rows[index].post_id,
        item_type: patch.itemType ?? rows[index].item_type,
        title: patch.title ?? rows[index].title,
        description: patch.description ?? rows[index].description,
        scheduled_at: patch.scheduledAt ?? rows[index].scheduled_at,
        status: patch.status ?? rows[index].status,
        checklist: patch.checklist ?? rows[index].checklist,
        updated_at: this.now().toISOString(),
      },
    };
    rows[index] = merged;
    this.writeItems(rows);
    return rowToItem(merged);
  }

  async remove(id: string, brandId: string): Promise<void> {
    const rows = this.readItems();
    const next = rows.filter(
      (row) => !(row.id === id && row.brand_id === brandId),
    );
    if (next.length === rows.length) {
      throw new CalendarAccessError("Takvim kaydı bulunamadı.");
    }
    this.writeItems(next);
  }
}
