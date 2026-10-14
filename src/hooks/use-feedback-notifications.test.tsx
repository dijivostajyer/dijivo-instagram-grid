// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useFeedbackNotifications } from "./use-feedback-notifications";
import type { FeedbackNotificationItem, FeedbackNotificationSummary } from "@/lib/feedback-notifications";

const item = (id: string, readAt: string | null = null): FeedbackNotificationItem => ({
  id, brandId: "b", projectId: "p", targetType: "post", targetId: "x", action: "approved", messagePreview: null,
  clientName: "Ayşe", createdAt: "2026-10-14T10:00:00.000Z", readAt,
});

let visibility: DocumentVisibilityState = "visible";
function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function sourceWith(responses: FeedbackNotificationSummary[]) {
  let index = 0;
  const notifications = vi.fn(async () => responses[Math.min(index++, responses.length - 1)]);
  const markAllRead = vi.fn(async () => ({ updated: 2, unreadCount: 0 }));
  return { notifications, markAllRead };
}

describe("useFeedbackNotifications", () => {
  it("O. açılışta yükler; 60 sn sonra yeni geri bildirimi yakalar", async () => {
    const source = sourceWith([{ count: 1, items: [item("1")] }, { count: 2, items: [item("2"), item("1")] }]);
    const { result } = renderHook(() => useFeedbackNotifications(source));
    await flush();
    expect(result.current.count).toBe(1);
    expect(source.notifications).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(59_000); });
    expect(source.notifications).toHaveBeenCalledTimes(1); // agresif değil
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await flush();
    expect(source.notifications).toHaveBeenCalledTimes(2);
    expect(result.current.count).toBe(2);
    expect(result.current.items.map((entry) => entry.id)).toEqual(["2", "1"]);
  });

  it("P. sekme gizliyken yoklamaz; görünür olunca veri eskiyse hemen yeniler", async () => {
    const source = sourceWith([{ count: 0, items: [] }]);
    renderHook(() => useFeedbackNotifications(source));
    await flush();
    expect(source.notifications).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(source.notifications).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(source.notifications).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(source.notifications).toHaveBeenCalledTimes(3);
  });

  it("hata sonrası aralık uzar (geri çekilme)", async () => {
    const notifications = vi.fn(async (): Promise<FeedbackNotificationSummary> => { throw new Error("tablo yok"); });
    const { result } = renderHook(() => useFeedbackNotifications({ notifications, markAllRead: vi.fn() }));
    await flush();
    expect(result.current.error).toBe("tablo yok");
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(notifications).toHaveBeenCalledTimes(1); // 1 hata → 120 sn bekler
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(notifications).toHaveBeenCalledTimes(2);
  });

  it("enabled=false iken hiç istek atmaz", async () => {
    const source = sourceWith([{ count: 0, items: [] }]);
    renderHook(() => useFeedbackNotifications(source, { enabled: false }));
    await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
    expect(source.notifications).not.toHaveBeenCalled();
  });

  it("okundu yansıtma ve tümünü okundu yap; okunmuş kayıt yeniden 'yeni' olmaz", async () => {
    const source = sourceWith([{ count: 2, items: [item("1"), item("2"), item("3", "2026-10-01T00:00:00.000Z")] }]);
    const { result } = renderHook(() => useFeedbackNotifications(source));
    await flush();
    act(() => result.current.applyRead({ ids: ["1"], unreadCount: 1 }));
    expect(result.current.count).toBe(1);
    expect(result.current.items.map((entry) => Boolean(entry.readAt))).toEqual([true, false, true]);
    await act(async () => { await result.current.markAllRead(); });
    expect(source.markAllRead).toHaveBeenCalledTimes(1);
    expect(result.current.count).toBe(0);
    expect(result.current.items.every((entry) => entry.readAt)).toBe(true);
    expect(result.current.items[2].readAt).toBe("2026-10-01T00:00:00.000Z");
  });
});
