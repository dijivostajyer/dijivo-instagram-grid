// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import BackupCenter from "./BackupCenter";
import { BackupRequestError, type BackupCenterSource } from "@/lib/backup/client";
import type { BackupJobView, BackupOverview } from "@/lib/backup/shared";

afterEach(cleanup);

const job = (overrides: Partial<BackupJobView>): BackupJobView => ({
  id: "j", operation: "backup", kind: "manual", status: "succeeded", actor: "user", actorUserId: "u", fileName: "backup-2026-10-14-113000-aaaaaaaa.zip",
  sizeBytes: 5 * 1024 * 1024, dbRowCount: 120, mediaFileCount: 14, startedAt: "2026-10-14T11:30:00.000Z", finishedAt: "2026-10-14T11:31:12.000Z",
  durationMs: 72_000, errorStage: null, errorMessage: null, sourceBackupId: null, safetyBackupId: null, progress: null, warnings: [], restorable: true, restoreEpoch: null,
  ...overrides,
});

function overviewWith(overrides: Partial<BackupOverview> = {}): BackupOverview {
  return {
    settings: { autoEnabled: true, intervalMinutes: 1440, keepLast: 10, keepDailyDays: 7, keepWeeklyWeeks: 4, keepPreRestoreDays: 14, updatedAt: null },
    jobs: [
      job({ id: "ok-1" }),
      job({ id: "auto-1", kind: "scheduled", actor: "cron", actorUserId: null, startedAt: "2026-10-13T11:30:00.000Z" }),
      job({ id: "fail-1", status: "failed", restorable: false, fileName: null, sizeBytes: null, errorStage: "download_media", errorMessage: "Yedekleme başarısız: Medya dosyası indirilemedi." }),
      job({ id: "pre-1", kind: "pre_restore", startedAt: "2026-10-12T08:00:00.000Z" }),
    ],
    running: null,
    lastSuccessAt: "2026-10-14T11:31:12.000Z",
    nextAutoAt: "2099-10-15T11:30:00.000Z",
    cronLastSeenAt: new Date().toISOString(),
    cronConfigured: true,
    cooldownUntil: null,
    totalBytes: 15 * 1024 * 1024,
    storage: { ok: true, error: null },
    ...overrides,
  };
}

function fakeSource(initial: BackupOverview) {
  const state = { overview: initial };
  const source = {
    overview: vi.fn(async () => state.overview),
    startBackup: vi.fn(async () => {
      const running = job({ id: "new", status: "running", restorable: false, fileName: null, progress: { stage: "download_media", done: 3, total: 14 } });
      state.overview = { ...state.overview, running, jobs: [running, ...state.overview.jobs] };
      return running;
    }),
    updateSettings: vi.fn(async (patch) => ({ ...state.overview.settings, ...patch })),
    details: vi.fn(async (id: string) => ({ job: state.overview.jobs.find((item) => item.id === id)!, manifest: null, fileAvailable: true })),
    validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
    restore: vi.fn(async () => {
      const running = job({ id: "restore-1", operation: "restore", kind: "restore", status: "running", restorable: false, progress: { stage: "safety_backup" } });
      state.overview = { ...state.overview, running, jobs: [running, ...state.overview.jobs] };
      return running;
    }),
    remove: vi.fn(async () => undefined),
    download: vi.fn(async () => ({ blob: new Blob(["PK"]), fileName: "x.zip" })),
  } satisfies BackupCenterSource;
  return { source, state };
}

function finish(state: { overview: BackupOverview }, id: string, patch: Partial<BackupJobView>) {
  state.overview = {
    ...state.overview,
    running: null,
    jobs: state.overview.jobs.map((item) => (item.id === id ? { ...item, status: "succeeded", progress: null, ...patch } : item)),
  };
}

async function renderCenter(overview = overviewWith(), onRestored = vi.fn()) {
  const { source, state } = fakeSource(overview);
  render(<BackupCenter source={source} onRestored={onRestored} pollMs={20} />);
  await screen.findByRole("button", { name: /Şimdi Yedekle/ });
  return { source, state, onRestored };
}

describe("Yedekleme sayfası", () => {
  it("üst bölüm: son başarılı, sonraki otomatik, toplam boyut", async () => {
    await renderCenter();
    const summary = screen.getByRole("region", { name: "Yedekleme durumu" });
    expect(within(summary).getByText("Son başarılı yedek").nextSibling?.textContent).toMatch(/^14 Ekim 2026, \d{2}:\d{2}$/);
    expect(within(summary).getByText("Sonraki otomatik yedek").nextSibling?.textContent).toMatch(/^15 Ekim 2099, \d{2}:\d{2}$/);
    expect(within(summary).getByText("15 MB")).toBeTruthy();
  });

  it("K/8. periyot seçenekleri yalnız 15 dk ve üstü", async () => {
    await renderCenter();
    const select = screen.getByLabelText(/Periyot/) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["15 dakika", "30 dakika", "1 saat", "3 saat", "6 saat", "12 saat", "Günlük", "Haftalık"]);
    expect([...select.options].some((option) => Number(option.value) < 15)).toBe(false);
  });

  it("A. Şimdi Yedekle → 'Yedekleniyor...' (tekrar tıklanamaz) → tamamlanınca liste yenilenir", async () => {
    const { source, state } = await renderCenter();
    fireEvent.click(screen.getByRole("button", { name: /Şimdi Yedekle/ }));
    const busy = await screen.findByRole("button", { name: /Yedekleniyor\.\.\./ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByTestId("running-job")).toBeTruthy();
    expect(screen.getByTestId("running-job").textContent).toMatch(/Medya paketleme \(3\/14\)/);
    expect(source.startBackup).toHaveBeenCalledTimes(1);

    act(() => finish(state, "new", { restorable: true }));
    await screen.findByText("Yedek oluşturuldu.");
    expect((screen.getByRole("button", { name: /Şimdi Yedekle/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("yarış: başlatılan iş, liste henüz yenilenmeden render olsa da izlenir ve sonucu bildirilir", async () => {
    const { source, state } = fakeSource(overviewWith());
    const onRestored = vi.fn();
    render(<BackupCenter source={source} onRestored={onRestored} pollMs={20} />);
    await screen.findByRole("button", { name: /Şimdi Yedekle/ });
    // Gerçek ağdaki gibi: geri yükleme yanıtından sonraki liste isteği gecikir;
    // arada bileşen eski listeyle (iş yok, çalışan iş yok) render olur.
    const slowOverview = source.overview.getMockImplementation()!;
    source.overview.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return slowOverview();
    });
    fireEvent.click(within(screen.getAllByTestId("backup-row")[0]).getByRole("button", { name: "Geri Yükle" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Geri Yükle" }));
    await screen.findByTestId("running-job", {}, { timeout: 2000 });
    act(() => finish(state, "restore-1", { restoreEpoch: "epoch-race" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith("epoch-race"), { timeout: 2000 });
    expect(await screen.findByText("Geri yükleme tamamlandı.")).toBeTruthy();
  });

  it("H. cooldown sürerken buton kapalı ve kalan süre yazılı; sunucu 429 mesajı gösterilir", async () => {
    await renderCenter(overviewWith({ cooldownUntil: new Date(Date.now() + 150_000).toISOString() }));
    expect((screen.getByRole("button", { name: /Şimdi Yedekle/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cooldown").textContent).toBe("Yeni bir manuel yedek için 3 dakika bekleyin.");
    cleanup();

    const { source } = fakeSource(overviewWith());
    source.startBackup.mockRejectedValueOnce(new BackupRequestError("Yeni bir manuel yedek için 5 dakika bekleyin.", 429, "2026-10-14T11:35:00.000Z"));
    render(<BackupCenter source={source} onRestored={vi.fn()} pollMs={20} />);
    fireEvent.click(await screen.findByRole("button", { name: /Şimdi Yedekle/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Yeni bir manuel yedek için 5 dakika bekleyin.");
  });

  it("9. geçmiş: tür/durum etiketleri; başarısız yedek geri yüklenemez", async () => {
    await renderCenter();
    const rows = screen.getAllByTestId("backup-row");
    expect(rows.map((row) => within(row).getAllByText(/^(Manuel|Otomatik|Geri yükleme öncesi)$/)[0].textContent)).toEqual(["Manuel", "Otomatik", "Manuel", "Geri yükleme öncesi"]);
    expect(within(rows[0]).getByText("Başarılı")).toBeTruthy();
    expect(within(rows[0]).getByText(/5 MB · 120 DB satırı · 14 medya · Süre: 1 dk 12 sn · Çalışma alanı sahibi/)).toBeTruthy();
    expect(within(rows[1]).getByText(/Zamanlayıcı/)).toBeTruthy();
    expect(within(rows[2]).getByText("Başarısız")).toBeTruthy();
    expect(within(rows[2]).getByText(/Medya paketleme: Yedekleme başarısız/)).toBeTruthy();
    expect((within(rows[2]).getByRole("button", { name: "Geri Yükle" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rows[0]).getByRole("button", { name: "Geri Yükle" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("11. geri yükleme modalı: açıklama + tarih + açık onay; tamamlanınca yerel durum sıfırlanır", async () => {
    const { source, state, onRestored } = await renderCenter();
    fireEvent.click(within(screen.getAllByTestId("backup-row")[0]).getByRole("button", { name: "Geri Yükle" }));
    const dialog = screen.getByRole("dialog", { name: "Yedeği geri yükle" });
    expect(within(dialog).getByText("Bu işlem mevcut çalışma alanı verilerini seçilen yedekle değiştirecek.")).toBeTruthy();
    expect(within(dialog).getByTestId("restore-target").textContent).toMatch(/^14 Ekim 2026, \d{2}:\d{2} yedeğine dönülecek\.$/);
    const confirm = within(dialog).getByRole("button", { name: "Geri Yükle" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => { fireEvent.click(confirm); });
    expect(source.restore).toHaveBeenCalledWith("ok-1");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await screen.findByTestId("running-job")).textContent).toMatch(/Geri yükleme sürüyor: Geri yükleme öncesi yedek/);
    expect((screen.getByRole("button", { name: /Şimdi Yedekle/ }) as HTMLButtonElement).disabled).toBe(true);

    act(() => finish(state, "restore-1", { restoreEpoch: "epoch-9" }));
    await screen.findByText("Geri yükleme tamamlandı.");
    expect(onRestored).toHaveBeenCalledWith("epoch-9");
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("14. geri yükleme başarısızsa Türkçe güvenli hata; yerel durum sıfırlanmaz", async () => {
    const { state, onRestored } = await renderCenter();
    fireEvent.click(within(screen.getAllByTestId("backup-row")[0]).getByRole("button", { name: "Geri Yükle" }));
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Geri Yükle" })); });
    await screen.findByTestId("running-job");
    act(() => finish(state, "restore-1", { status: "failed", errorStage: "safety_backup", errorMessage: "Geri yükleme öncesi güvenlik yedeği alınamadı; geri yükleme başlatılmadı. Mevcut veriler değiştirilmedi." }));
    expect((await screen.findByRole("alert")).textContent).toContain("Geri yükleme öncesi güvenlik yedeği alınamadı; geri yükleme başlatılmadı. Mevcut veriler değiştirilmedi.");
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("18. silme onay ister; pre-restore yedekte ek uyarı", async () => {
    const { source } = await renderCenter();
    fireEvent.click(within(screen.getAllByTestId("backup-row")[3]).getByRole("button", { name: "Sil" }));
    const dialog = screen.getByRole("dialog", { name: "Yedeği sil" });
    expect(within(dialog).getByText("Bu bir geri yükleme öncesi güvenlik yedeğidir.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Vazgeç" }));
    expect(source.remove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getAllByTestId("backup-row")[0]).getByRole("button", { name: "Sil" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sil" })); });
    expect(source.remove).toHaveBeenCalledWith("ok-1");
    await screen.findByText("Yedek silindi.");
  });

  it("ayarlar: yalnız değişen alanlar gönderilir", async () => {
    const { source } = await renderCenter();
    fireEvent.click(screen.getByRole("switch", { name: "Otomatik yedekleme" }));
    fireEvent.change(screen.getByLabelText(/Periyot/), { target: { value: "15" } });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ayarları Kaydet" })); });
    expect(source.updateSettings).toHaveBeenCalledWith({ intervalMinutes: 15 });
    await screen.findByText("Yedekleme ayarları kaydedildi.");
  });

  it("depolama yapılandırılmamışsa yedek alınamaz; zamanlayıcı çalışmadıysa uyarı", async () => {
    await renderCenter(overviewWith({ storage: { ok: false, error: "Yedek dizini yapılandırılmamış (BACKUP_DIR). Yedekleme devre dışı." }, cronLastSeenAt: null }));
    expect((screen.getByRole("button", { name: /Şimdi Yedekle/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Yedek dizini yapılandırılmamış (BACKUP_DIR). Yedekleme devre dışı.");
    expect(screen.getByTestId("cron-warning").textContent).toMatch(/Zamanlayıcı henüz hiç çalışmadı/);
  });

  it("ayrıntılar: doğrulama sonucu ve indirme", async () => {
    const { source } = await renderCenter();
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    fireEvent.click(within(screen.getAllByTestId("backup-row")[0]).getByRole("button", { name: "Ayrıntılar" }));
    const dialog = await screen.findByRole("dialog", { name: "Yedek ayrıntıları" });
    await within(dialog).findByText("backup-2026-10-14-113000-aaaaaaaa.zip");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Doğrula/ })); });
    expect(within(dialog).getByTestId("validation-result").textContent).toBe("Yedek doğrulandı: paket, manifest ve tüm sağlama toplamları geçerli.");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /İndir/ })); });
    expect(source.download).toHaveBeenCalledWith("ok-1");
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });
});
