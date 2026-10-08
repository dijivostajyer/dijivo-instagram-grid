import type { CalendarItem } from "./calendar-types";
import type {
  CalendarItemInput,
  CalendarPatch,
} from "./calendar-store";

/**
 * Sunucu tarafı API katmanına (src/app/api/calendar/*) dayalı
 * takvim depolama. Yalnızca Supabase yapılandırılmışsa
 * kullanılır; secret key istemci bundle'ına asla girmez (§28) —
 * istemci yalnızca HTTP üzerinden kendi kayıtlarını okur/yazar.
 *
 * Arayüz `CalendarStoreLike` ile birebir aynıdır; hook hangi
 * katmanı kullandığını bilmez.
 */

class ApiCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiCalendarError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiCalendarError(
      "Takvim sunucusuna bağlanılamadı. Lütfen tekrar deneyin.",
      0,
    );
  }
  if (!response.ok) {
    let message = "Takvim işlemi başarısız oldu. Lütfen tekrar deneyin.";
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Boş gövde: varsayılan mesaj kullanılır.
    }
    throw new ApiCalendarError(message, response.status);
  }
  // 204 No Content (silme) için boş gövde.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function toQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

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

import { withBasePath } from "./base-path";
export function createApiCalendarStore(
  base = "/api/calendar",
): CalendarStoreLike {
  return {
    async list(brandId, projectId) {
      const query = toQuery({ brandId, projectId });
      const body = await request<{ items: CalendarItem[] }>(
        `${withBasePath(base)}/items?${query}`,
      );
      return body.items;
    },
    async listAll(brandId) {
      const query = toQuery({ brandId });
      const body = await request<{ items: CalendarItem[] }>(
        `${withBasePath(base)}/brand-items?${query}`,
      );
      return body.items;
    },
    async create(input: CalendarItemInput) {
      const body = await request<{ item: CalendarItem }>(`${withBasePath(base)}/items`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.item;
    },
    async update(id, patch: CalendarPatch, brandId) {
      const query = toQuery({ brandId });
      const body = await request<{ item: CalendarItem }>(
        `${withBasePath(base)}/items/${encodeURIComponent(id)}?${query}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.item;
    },
    async remove(id, brandId) {
      const query = toQuery({ brandId });
      await request(
        `${withBasePath(base)}/items/${encodeURIComponent(id)}?${query}`,
        { method: "DELETE" },
      );
    },
  };
}
