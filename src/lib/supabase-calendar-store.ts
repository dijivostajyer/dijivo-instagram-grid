import { createClient } from "@supabase/supabase-js";

import {
  type CalendarItem,
  type CalendarItemRow,
  type ReminderDelivery,
  type ReminderDeliveryRow,
} from "./calendar-types";
import {
  CalendarAccessError,
  type CalendarItemInput,
  type CalendarPatch,
  type CalendarStoreLike,
  type ReminderDeliveryInput,
} from "./calendar-store";
import {
  randomId,
  validateCalendarInput,
  validateCalendarPatch,
} from "./calendar-utils";

/**
 * Sunucu tarafı Supabase sürücüsü (service-role).
 * Yalnızca Next.js API route'larından çağrılır;
 * secret key istemci bundle'ına asla girmez (§28).
 */
export interface SupabaseCalendarConfig {
  url: string;
  secretKey: string;
}

export function getSupabaseCalendarConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseCalendarConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) return null;
  return { url, secretKey };
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
    reminderOffsetMinutes: row.reminder_offset_minutes,
    remindAt: row.remind_at ?? null,
    checklist: row.checklist ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDelivery(row: ReminderDeliveryRow): ReminderDelivery {
  return {
    id: row.id,
    itemId: row.item_id,
    brandId: row.brand_id,
    channel: row.channel,
    remindAt: row.remind_at,
    scheduledAt: row.scheduled_at,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
  };
}

export interface SupabaseCalendarDriver {
  listItems(brandId: string, projectId: string): Promise<CalendarItem[]>;
  listItemsByBrand(brandId: string): Promise<CalendarItem[]>;
  insertItem(row: Omit<CalendarItemRow, "created_at" | "updated_at">): Promise<CalendarItem>;
  updateItem(
    id: string,
    brandId: string,
    patch: Partial<Omit<CalendarItemRow, "id" | "brand_id" | "created_at" | "updated_at">>,
  ): Promise<CalendarItem>;
  deleteItem(id: string, brandId: string): Promise<void>;
  listDeliveries(brandId: string): Promise<ReminderDelivery[]>;
  /**
   * Hatırlatmayı teslim eder. `(item_id, remind_at)`
   * eşsizliği sayesinde once-only (§27) garantisidir;
   * çift teslim 23505 hatasıyla reddedilir.
   */
  insertDelivery(
    row: Omit<ReminderDeliveryRow, "id" | "created_at" | "delivered_at" | "read_at">,
  ): Promise<ReminderDelivery>;
  markDeliveryRead(id: string, brandId: string): Promise<void>;
  markAllDeliveriesRead(brandId: string): Promise<void>;
}

export function createSupabaseCalendarDriver(
  config: SupabaseCalendarConfig,
): SupabaseCalendarDriver {
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ITEM_SELECT =
    "id,brand_id,project_id,post_id,item_type,title,description,scheduled_at,status,reminder_offset_minutes,remind_at,checklist,created_at,updated_at";
  const DELIVERY_SELECT =
    "id,item_id,brand_id,channel,remind_at,scheduled_at,title,body,created_at,delivered_at,read_at";

  return {
    async listItems(brandId, projectId) {
      const { data, error } = await client
        .from("calendar_items")
        .select(ITEM_SELECT)
        .eq("brand_id", brandId)
        .eq("project_id", projectId)
        .order("scheduled_at", { ascending: true });
      if (error) throw new Error("Takvim kayıtları okunamadı.");
      return (data ?? []).map(rowToItem);
    },
    async listItemsByBrand(brandId) {
      const { data, error } = await client
        .from("calendar_items")
        .select(ITEM_SELECT)
        .eq("brand_id", brandId)
        .order("scheduled_at", { ascending: true });
      if (error) throw new Error("Takvim kayıtları okunamadı.");
      return (data ?? []).map(rowToItem);
    },
    async insertItem(row) {
      const { data, error } = await client
        .from("calendar_items")
        .insert({ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select(ITEM_SELECT)
        .maybeSingle();
      if (error) throw new Error("Takvim kaydı oluşturulamadı.");
      if (!data) throw new Error("Takvim kaydı oluşturulamadı.");
      return rowToItem(data as CalendarItemRow);
    },
    async updateItem(id, brandId, patch) {
      const { data, error } = await client
        .from("calendar_items")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("brand_id", brandId)
        .select(ITEM_SELECT)
        .maybeSingle();
      if (error) throw new Error("Takvim kaydı güncellenemedi.");
      if (!data) throw new Error("Takvim kaydı bulunamadı.");
      return rowToItem(data as CalendarItemRow);
    },
    async deleteItem(id, brandId) {
      const { error, count } = await client
        .from("calendar_items")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("brand_id", brandId);
      if (error) throw new Error("Takvim kaydı silinemedi.");
      if (!count) throw new Error("Takvim kaydı bulunamadı.");
    },
    async listDeliveries(brandId) {
      const { data, error } = await client
        .from("reminder_deliveries")
        .select(DELIVERY_SELECT)
        .eq("brand_id", brandId)
        .order("delivered_at", { ascending: false });
      if (error) throw new Error("Bildirimler okunamadı.");
      return (data ?? []).map(rowToDelivery);
    },
    async insertDelivery(row) {
      const payload = {
        ...row,
        created_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        read_at: null,
      };
      const { data, error } = await client
        .from("reminder_deliveries")
        .insert(payload)
        .select(DELIVERY_SELECT)
        .maybeSingle();
      if (error) {
        // 23505: unique (item_id, remind_at) — zaten teslim edildi.
        if (error.code === "23505") {
          throw Object.assign(new Error("Hatırlatma zaten teslim edildi."), { code: "duplicate" });
        }
        throw new Error("Hatırlatma kaydedilemedi.");
      }
      if (!data) throw new Error("Hatırlatma kaydedilemedi.");
      return rowToDelivery(data as ReminderDeliveryRow);
    },
    async markDeliveryRead(id, brandId) {
      const { error } = await client
        .from("reminder_deliveries")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("brand_id", brandId);
      if (error) throw new Error("Bildirim güncellenemedi.");
    },
    async markAllDeliveriesRead(brandId) {
      const { error } = await client
        .from("reminder_deliveries")
        .update({ read_at: new Date().toISOString() })
        .eq("brand_id", brandId)
        .is("read_at", null);
      if (error) throw new Error("Bildirimler güncellenemedi.");
    },
  };
}

/**
 * Sunucu tarafı `CalendarStoreLike` adapter'ı: API katmanından
 * (src/app/api/calendar/*) çağrılır. Doğrulama, kimlik üretimi
 * ve hata eşlemesi burada yapılır; secret key istemciye asla
 * gitmez (§28).
 */
export class SupabaseCalendarStore implements CalendarStoreLike {
  constructor(private readonly driver: SupabaseCalendarDriver) {}

  async list(brandId: string, projectId: string): Promise<CalendarItem[]> {
    try {
      return await this.driver.listItems(brandId, projectId);
    } catch (error) {
      throw accessError(error, "Takvim kayıtları okunamadı.");
    }
  }

  async listAll(brandId: string): Promise<CalendarItem[]> {
    try {
      return await this.driver.listItemsByBrand(brandId);
    } catch (error) {
      throw accessError(error, "Takvim kayıtları okunamadı.");
    }
  }

  async create(input: CalendarItemInput): Promise<CalendarItem> {
    const error = validateCalendarInput(input);
    if (error) throw new CalendarAccessError(error);
    const timestamp = new Date().toISOString();
    const row: Omit<CalendarItemRow, "created_at" | "updated_at"> = {
      id: randomId(),
      brand_id: input.brandId,
      project_id: input.projectId,
      post_id: input.postId,
      item_type: input.itemType,
      title: input.title.trim(),
      description: input.description,
      scheduled_at: input.scheduledAt,
      status: input.status,
      reminder_offset_minutes: input.reminderOffsetMinutes,
      checklist: input.checklist,
    };
    try {
      return await this.driver.insertItem(row);
    } catch (err) {
      throw accessError(err, "Takvim kaydı oluşturulamadı.");
    }
  }

  async update(
    id: string,
    patch: CalendarPatch,
    brandId: string,
  ): Promise<CalendarItem> {
    const error = validateCalendarPatch(patch);
    if (error) throw new CalendarAccessError(error);
    const rowPatch: Parameters<SupabaseCalendarDriver["updateItem"]>[2] = {};
    if (patch.postId !== undefined) rowPatch.post_id = patch.postId;
    if (patch.itemType !== undefined) rowPatch.item_type = patch.itemType;
    if (patch.title !== undefined) rowPatch.title = patch.title.trim();
    if (patch.description !== undefined) rowPatch.description = patch.description;
    if (patch.scheduledAt !== undefined) rowPatch.scheduled_at = patch.scheduledAt;
    if (patch.status !== undefined) rowPatch.status = patch.status;
    if (patch.reminderOffsetMinutes !== undefined) {
      rowPatch.reminder_offset_minutes = patch.reminderOffsetMinutes;
    }
    if (patch.checklist !== undefined) rowPatch.checklist = patch.checklist;
    if (Object.keys(rowPatch).length === 0) {
      throw new CalendarAccessError("Güncellenecek alan yok.");
    }
    try {
      return await this.driver.updateItem(id, brandId, rowPatch);
    } catch (err) {
      throw accessError(err, "Takvim kaydı güncellenemedi.");
    }
  }

  async remove(id: string, brandId: string): Promise<void> {
    try {
      await this.driver.deleteItem(id, brandId);
    } catch (error) {
      throw accessError(error, "Takvim kaydı silinemedi.");
    }
  }

  async listDeliveries(brandId: string): Promise<ReminderDelivery[]> {
    try {
      return await this.driver.listDeliveries(brandId);
    } catch (error) {
      throw accessError(error, "Bildirimler okunamadı.");
    }
  }

  async deliverReminder(
    delivery: ReminderDeliveryInput,
  ): Promise<ReminderDelivery> {
    try {
      return await this.driver.insertDelivery({
        item_id: delivery.itemId,
        brand_id: delivery.brandId,
        channel: delivery.channel,
        remind_at: delivery.remindAt,
        scheduled_at: delivery.scheduledAt,
        title: delivery.title,
        body: delivery.body,
      });
    } catch (error) {
      // (item_id, remind_at) eşsizliği: once-only (§27).
      if (isDuplicateError(error)) {
        throw new CalendarAccessError("Hatırlatma zaten teslim edildi.");
      }
      throw accessError(error, "Hatırlatma kaydedilemedi.");
    }
  }

  async markRead(deliveryId: string, brandId: string): Promise<void> {
    try {
      await this.driver.markDeliveryRead(deliveryId, brandId);
    } catch (error) {
      throw accessError(error, "Bildirim güncellenemedi.");
    }
  }

  async markAllRead(brandId: string): Promise<void> {
    try {
      await this.driver.markAllDeliveriesRead(brandId);
    } catch (error) {
      throw accessError(error, "Bildirimler güncellenemedi.");
    }
  }
}

function accessError(error: unknown, fallback: string): CalendarAccessError {
  const message = error instanceof Error ? error.message : fallback;
  return new CalendarAccessError(message || fallback);
}

function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "duplicate"
  );
}
