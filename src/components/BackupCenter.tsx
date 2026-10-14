"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";

import { BackupRequestError, type BackupCenterSource } from "@/lib/backup/client";
import {
  BACKUP_INTERVALS,
  BACKUP_KIND_LABELS,
  BACKUP_STATUS_LABELS,
  formatBackupDateTime,
  formatBytes,
  formatDuration,
  stageLabel,
  type BackupDetails,
  type BackupJobView,
  type BackupOverview,
  type BackupSettingsView,
  type BackupValidationResult,
} from "@/lib/backup/shared";

const RUNNING_POLL_MS = 2_000;
/** Zamanlayıcı bu süreden uzun görülmediyse uyarı (cron 15 dakikada bir önerilir). */
const CRON_STALE_MS = 45 * 60_000;

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

const STATUS_BADGE: Record<BackupJobView["status"], string> = {
  running: "bg-sky-50 text-sky-800 ring-sky-200",
  succeeded: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-red-50 text-red-800 ring-red-200",
};

const buttonBase = "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = `${buttonBase} bg-neutral-900 text-white hover:bg-neutral-700`;
const secondaryButton = `${buttonBase} border border-slate-200 bg-white text-neutral-700 hover:bg-neutral-50`;
const dangerButton = `${buttonBase} bg-red-600 text-white hover:bg-red-700`;
const smallButton = "inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-40";
const inputClass = "h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-neutral-800 focus:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/30";

function actorLabel(job: BackupJobView): string {
  return job.actor === "cron" ? "Zamanlayıcı" : "Çalışma alanı sahibi";
}

function progressText(job: BackupJobView): string {
  const stage = stageLabel(job.progress?.stage) || "Hazırlanıyor";
  return job.progress?.total ? `${stage} (${job.progress.done ?? 0}/${job.progress.total})` : stage;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Dialog({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className={`relative my-6 w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-neutral-900">{label}</h3>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Kapat" className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
            <XMarkIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SettingsForm({ settings, disabled, onSave }: { settings: BackupSettingsView; disabled: boolean; onSave: (next: BackupSettingsView) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const numberField = (key: "keepLast" | "keepDailyDays" | "keepWeeklyWeeks" | "keepPreRestoreDays", label: string, min: number, max: number) => (
    <label className="block min-w-0 text-xs font-medium text-neutral-600">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key]}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: Math.min(max, Math.max(min, Math.round(Number(event.target.value) || 0))) }))}
        className={`${inputClass} mt-1`}
      />
    </label>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave(draft).finally(() => setSaving(false));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900" id="auto-backup-label">Otomatik yedekleme</p>
          <p className="text-xs text-neutral-500">Sunucudaki zamanlayıcı (cPanel Cron Job) tarafından çalıştırılır.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.autoEnabled}
          aria-labelledby="auto-backup-label"
          onClick={() => setDraft((current) => ({ ...current, autoEnabled: !current.autoEnabled }))}
          className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${draft.autoEnabled ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-neutral-600"}`}
        >
          <span className={`size-2.5 rounded-full ${draft.autoEnabled ? "bg-emerald-500" : "bg-neutral-300"}`} aria-hidden="true" />
          {draft.autoEnabled ? "Açık" : "Kapalı"}
        </button>
      </div>
      <label className="block text-xs font-medium text-neutral-600">
        Periyot
        <select
          value={draft.intervalMinutes}
          onChange={(event) => setDraft((current) => ({ ...current, intervalMinutes: Number(event.target.value) }))}
          disabled={!draft.autoEnabled}
          className={`${inputClass} mt-1`}
        >
          {BACKUP_INTERVALS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
        </select>
        <span className="mt-1 block font-normal text-neutral-500">Tam yedek (veritabanı + medya) için en kısa aralık 15 dakikadır. Değişiklik yoksa otomatik yedek yeni dosya oluşturmaz.</span>
      </label>
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Saklama politikası</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {numberField("keepLast", "Son yedek sayısı", 1, 100)}
          {numberField("keepDailyDays", "Günlük (gün)", 0, 90)}
          {numberField("keepWeeklyWeeks", "Haftalık (hafta)", 0, 52)}
          {numberField("keepPreRestoreDays", "Geri yükleme öncesi (gün)", 1, 90)}
        </div>
        <p className="mt-2 text-xs text-neutral-500">Eski yedekler yalnız yeni bir yedek başarıyla alındıktan sonra temizlenir. En yeni geri yükleme öncesi yedek her zaman korunur.</p>
      </fieldset>
      <button type="submit" disabled={disabled || saving || !dirty} className={secondaryButton}>
        {saving ? "Kaydediliyor..." : "Ayarları Kaydet"}
      </button>
    </form>
  );
}

/**
 * Yedekleme + geri yükleme merkezi. Uzun işler sunucuda sürer; sayfa
 * çalışan iş varken birkaç saniyede bir durumu yoklar.
 */
export default function BackupCenter({
  source,
  onRestored,
  pollMs = RUNNING_POLL_MS,
}: {
  source: BackupCenterSource;
  /** Başarılı (veya DB'si işlenmiş) geri yüklemede: yerel önbelleği sıfırla ve yeniden yükle. */
  onRestored: (epoch: string) => void | Promise<void>;
  pollMs?: number;
}) {
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [starting, setStarting] = useState(false);
  const [tracked, setTracked] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [restoreFor, setRestoreFor] = useState<BackupJobView | null>(null);
  const [deleteFor, setDeleteFor] = useState<BackupJobView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const restoredHandled = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await source.overview();
      setOverview(next);
      setLoadError(null);
      setNow(Date.now());
      return next;
    } catch (error) {
      setLoadError(errorMessage(error, "Yedekleme bilgileri yüklenemedi."));
      return null;
    }
  }, [source]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = overview?.running ?? null;
  useEffect(() => {
    if (!running && !tracked) return;
    const timer = window.setInterval(() => void load(), pollMs);
    return () => window.clearInterval(timer);
  }, [running, tracked, load, pollMs]);

  // Cooldown geri sayımı için periyodik yeniden çizim.
  const cooldownUntil = overview?.cooldownUntil ? Date.parse(overview.cooldownUntil) : 0;
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  // Bu sayfadan başlatılan işin sonucu.
  useEffect(() => {
    if (!tracked || !overview) return;
    // İş henüz listede yoksa (yeni liste gelmeden önceki render) beklenir;
    // izlenen yedek/geri yükleme kayıtları silinmediği için sonraki yoklamada görünür.
    const job = overview.jobs.find((item) => item.id === tracked);
    if (!job || job.status === "running") return;
    setTracked(null);
    if (job.operation === "backup") {
      setNotice(job.status === "succeeded" ? { tone: "success", text: "Yedek oluşturuldu." } : { tone: "error", text: job.errorMessage ?? "Yedekleme başarısız." });
      return;
    }
    if (job.restoreEpoch && !restoredHandled.current) {
      restoredHandled.current = true;
      setNotice(job.status === "succeeded"
        ? { tone: "success", text: "Geri yükleme tamamlandı." }
        : { tone: "error", text: `${job.errorMessage ?? "Geri yükleme tamamlanamadı."} Önceki duruma dönmek için "Geri yükleme öncesi" yedeğini geri yükleyebilirsiniz.` });
      void onRestored(job.restoreEpoch);
      return;
    }
    if (job.status === "failed") {
      setNotice({ tone: "error", text: `${job.errorMessage ?? "Geri yükleme başarısız oldu."}${job.errorMessage?.includes("değiştirilmedi") ? "" : " Mevcut verileriniz değiştirilmedi."}` });
    }
  }, [overview, tracked, onRestored]);

  async function startBackup() {
    setStarting(true);
    setNotice(null);
    try {
      const job = await source.startBackup();
      setTracked(job.id);
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "Yedekleme başlatılamadı.") });
      if (error instanceof BackupRequestError && (error.status === 409 || error.status === 429)) await load();
    } finally {
      setStarting(false);
    }
  }

  async function saveSettings(next: BackupSettingsView) {
    if (!overview) return;
    const patch: Record<string, unknown> = {};
    for (const key of ["autoEnabled", "intervalMinutes", "keepLast", "keepDailyDays", "keepWeeklyWeeks", "keepPreRestoreDays"] as const) {
      if (next[key] !== overview.settings[key]) patch[key] = next[key];
    }
    try {
      const settings = await source.updateSettings(patch);
      setNotice({ tone: "success", text: "Yedekleme ayarları kaydedildi." });
      setOverview((current) => (current ? { ...current, settings } : current));
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "Ayarlar kaydedilemedi.") });
    }
  }

  async function confirmRestore(job: BackupJobView) {
    setNotice(null);
    try {
      const restoreJob = await source.restore(job.id);
      restoredHandled.current = false;
      setTracked(restoreJob.id);
      setRestoreFor(null);
      await load();
    } catch (error) {
      setRestoreFor(null);
      setNotice({ tone: "error", text: errorMessage(error, "Geri yükleme başlatılamadı.") });
      await load();
    }
  }

  async function confirmDelete(job: BackupJobView) {
    try {
      await source.remove(job.id);
      setDeleteFor(null);
      setNotice({ tone: "info", text: "Yedek silindi." });
      await load();
    } catch (error) {
      setDeleteFor(null);
      setNotice({ tone: "error", text: errorMessage(error, "Yedek silinemedi.") });
    }
  }

  if (!overview) {
    return (
      <div className="mx-auto max-w-[1100px]">
        {loadError ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError} <button type="button" onClick={() => void load()} className="ml-2 font-medium underline">Tekrar dene</button>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Yükleniyor…</p>
        )}
      </div>
    );
  }

  const { settings } = overview;
  const cooldownActive = cooldownUntil > now;
  const cooldownMinutes = Math.max(1, Math.ceil((cooldownUntil - now) / 60_000));
  const busy = Boolean(running) || starting;
  const backupRunning = starting || running?.operation === "backup";
  const restoreRunning = running?.operation === "restore";
  const nextAuto = !settings.autoEnabled
    ? "Otomatik yedekleme kapalı"
    : overview.nextAutoAt && Date.parse(overview.nextAutoAt) > now
      ? formatBackupDateTime(overview.nextAutoAt)
      : "Zamanlayıcının bir sonraki çalışmasında";
  const cronWarning = !settings.autoEnabled
    ? null
    : !overview.cronConfigured
      ? "Sunucuda BACKUP_CRON_SECRET tanımlı değil; otomatik yedekler çalışmaz."
      : !overview.cronLastSeenAt
        ? "Zamanlayıcı henüz hiç çalışmadı. cPanel Cron Job kurulumunu kontrol edin."
        : now - Date.parse(overview.cronLastSeenAt) > CRON_STALE_MS
          ? `Zamanlayıcı en son ${formatBackupDateTime(overview.cronLastSeenAt)} tarihinde çalıştı. cPanel Cron Job'ını kontrol edin.`
          : null;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">Çalışma alanının (veritabanı + medya) tam yedeği. Yedekler sunucuda, web'den erişilemeyen özel bir dizinde tutulur.</p>
        <button type="button" onClick={() => void startBackup()} disabled={busy || cooldownActive || !overview.storage.ok} className={primaryButton}>
          {backupRunning ? <ArrowPathIcon className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheckIcon className="size-4" aria-hidden="true" />}
          {backupRunning ? "Yedekleniyor..." : "Şimdi Yedekle"}
        </button>
      </div>

      {notice ? (
        <div role={notice.tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-neutral-700"}`}>
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat" className="shrink-0 rounded p-0.5 hover:bg-black/5"><XMarkIcon className="size-4" aria-hidden="true" /></button>
        </div>
      ) : null}
      {!overview.storage.ok ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{overview.storage.error}</div>
      ) : null}
      {cooldownActive && !busy ? (
        <p className="text-xs text-neutral-500" data-testid="cooldown">Yeni bir manuel yedek için {cooldownMinutes} dakika bekleyin.</p>
      ) : null}
      {running ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="running-job">
          <ArrowPathIcon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          <span className="min-w-0">
            {restoreRunning ? "Geri yükleme sürüyor" : `${BACKUP_KIND_LABELS[running.kind]} yedek alınıyor`}: {progressText(running)}
            {restoreRunning ? <span className="block text-xs text-sky-800">İşlem bitene kadar sayfayı kapatmayın; bu sırada çalışma alanında yapılan değişiklikler kaydedilmez.</span> : null}
          </span>
        </div>
      ) : null}

      <section aria-label="Yedekleme durumu" className="grid gap-3 sm:grid-cols-3">
        {[
          ["Son başarılı yedek", overview.lastSuccessAt ? formatBackupDateTime(overview.lastSuccessAt) : "Henüz yedek yok"],
          ["Sonraki otomatik yedek", nextAuto],
          ["Toplam yedek boyutu", formatBytes(overview.totalBytes)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-neutral-500">{label}</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">{value}</p>
          </div>
        ))}
      </section>
      {cronWarning ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="cron-warning">
          <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{cronWarning}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="backup-history-title" className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h2 id="backup-history-title" className="text-sm font-semibold text-neutral-900">Yedek geçmişi</h2>
            <button type="button" onClick={() => void load()} className="rounded-lg px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">Yenile</button>
          </div>
          {overview.jobs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500">Henüz yedek yok. İlk yedeği almak için “Şimdi Yedekle”ye tıklayın.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {overview.jobs.map((job) => (
                <li key={job.id} className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="backup-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900">{formatBackupDateTime(job.startedAt)}</span>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{BACKUP_KIND_LABELS[job.kind]}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[job.status]}`}>{BACKUP_STATUS_LABELS[job.status]}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {job.operation === "backup" ? `${formatBytes(job.sizeBytes)} · ${job.dbRowCount ?? "—"} DB satırı · ${job.mediaFileCount ?? "—"} medya · ` : ""}
                      {job.status === "running" ? progressText(job) : `Süre: ${formatDuration(job.durationMs)}`} · {actorLabel(job)}
                    </p>
                    {job.status === "failed" && job.errorMessage ? <p className="mt-1 text-xs text-red-700">{stageLabel(job.errorStage) ? `${stageLabel(job.errorStage)}: ` : ""}{job.errorMessage}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <button type="button" onClick={() => setDetailsFor(job.id)} className={`${smallButton} text-neutral-700 hover:bg-neutral-100`}>Ayrıntılar</button>
                    {job.operation === "backup" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setRestoreFor(job)}
                          disabled={!job.restorable || busy}
                          title={!job.restorable ? "Yalnız başarılı yedekler geri yüklenebilir." : undefined}
                          className={`${smallButton} text-sky-700 hover:bg-sky-50`}
                        >
                          Geri Yükle
                        </button>
                        <button type="button" onClick={() => setDeleteFor(job)} disabled={job.status === "running"} className={`${smallButton} text-red-700 hover:bg-red-50`}>Sil</button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="backup-settings-title" className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 id="backup-settings-title" className="mb-3 text-sm font-semibold text-neutral-900">Otomatik yedekleme</h2>
          <SettingsForm settings={settings} disabled={false} onSave={saveSettings} />
        </section>
      </div>

      {detailsFor ? <DetailsDialog id={detailsFor} source={source} onClose={() => setDetailsFor(null)} /> : null}

      {restoreFor ? (
        <RestoreDialog job={restoreFor} onCancel={() => setRestoreFor(null)} onConfirm={() => confirmRestore(restoreFor)} />
      ) : null}

      {deleteFor ? (
        <Dialog label="Yedeği sil" onClose={() => setDeleteFor(null)}>
          <p className="text-sm text-neutral-700">{formatBackupDateTime(deleteFor.startedAt)} tarihli yedek kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
          {deleteFor.kind === "pre_restore" ? <p className="mt-2 text-sm font-medium text-amber-800">Bu bir geri yükleme öncesi güvenlik yedeğidir.</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteFor(null)} className={secondaryButton}>Vazgeç</button>
            <button type="button" onClick={() => void confirmDelete(deleteFor)} className={dangerButton}>Sil</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function RestoreDialog({ job, onCancel, onConfirm }: { job: BackupJobView; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog label="Yedeği geri yükle" onClose={onCancel}>
      <p className="text-sm font-medium text-neutral-900">Bu işlem mevcut çalışma alanı verilerini seçilen yedekle değiştirecek.</p>
      <p className="mt-2 text-sm text-neutral-700" data-testid="restore-target">{formatBackupDateTime(job.startedAt)} yedeğine dönülecek.</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-600">
        <li>Başlamadan önce mevcut verilerin otomatik bir güvenlik yedeği alınır; alınamazsa geri yükleme başlamaz.</li>
        <li>Markalar, aylık planlar, gönderiler, Story'ler, takvim, paylaşım bağlantıları ve geri bildirimler yedekteki haline döner.</li>
        <li>Kullanıcı hesapları ve Instagram içe aktarma işleri değişmez. Süresi dolmuş paylaşımlar süresi dolmuş kalır.</li>
      </ul>
      <label className="mt-4 flex items-start gap-2 text-sm text-neutral-800">
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 size-4" />
        Mevcut verilerin değiştirileceğini anladım.
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>Vazgeç</button>
        <button
          type="button"
          disabled={!acknowledged || submitting}
          onClick={() => {
            setSubmitting(true);
            void onConfirm().finally(() => setSubmitting(false));
          }}
          className={dangerButton}
        >
          {submitting ? "Başlatılıyor..." : "Geri Yükle"}
        </button>
      </div>
    </Dialog>
  );
}

function DetailsDialog({ id, source, onClose }: { id: string; source: BackupCenterSource; onClose: () => void }) {
  const [details, setDetails] = useState<BackupDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<BackupValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    source.details(id).then(
      (value) => { if (!cancelled) setDetails(value); },
      (caught: unknown) => { if (!cancelled) setError(errorMessage(caught, "Ayrıntılar yüklenemedi.")); },
    );
    return () => { cancelled = true; };
  }, [id, source]);

  async function download() {
    setDownloading(true);
    try {
      const { blob, fileName } = await source.download(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (caught) {
      setError(errorMessage(caught, "Yedek indirilemedi."));
    } finally {
      setDownloading(false);
    }
  }

  async function validate() {
    setValidating(true);
    try {
      setValidation(await source.validate(id));
    } catch (caught) {
      setValidation({ ok: false, errors: [errorMessage(caught, "Doğrulama yapılamadı.")], warnings: [] });
    } finally {
      setValidating(false);
    }
  }

  const job = details?.job;
  const rows: Array<[string, string]> = job ? [
    ["Tarih", formatBackupDateTime(job.startedAt)],
    ["Tür", BACKUP_KIND_LABELS[job.kind]],
    ["Durum", BACKUP_STATUS_LABELS[job.status]],
    ["İşlem yapan", actorLabel(job)],
    ["Süre", formatDuration(job.durationMs)],
    ...(job.operation === "backup" ? [
      ["Dosya", job.fileName ?? "—"],
      ["Boyut", formatBytes(job.sizeBytes)],
      ["DB satırı", String(job.dbRowCount ?? "—")],
      ["Medya dosyası", String(job.mediaFileCount ?? "—")],
    ] as Array<[string, string]> : [["DB satırı", String(job.dbRowCount ?? "—")]] as Array<[string, string]>),
  ] : [];

  return (
    <Dialog label="Yedek ayrıntıları" onClose={onClose} wide>
      {error ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {!details && !error ? <p className="text-sm text-neutral-500">Yükleniyor…</p> : null}
      {job ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-neutral-500">{label}</dt>
                <dd className="min-w-0 break-words text-neutral-900">{value}</dd>
              </div>
            ))}
          </dl>
          {job.status === "failed" ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {stageLabel(job.errorStage) ? <strong className="font-semibold">{stageLabel(job.errorStage)}: </strong> : null}{job.errorMessage}
            </p>
          ) : null}
          {job.warnings.length ? <ul className="list-disc pl-5 text-sm text-amber-800">{job.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
          {details?.manifest ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Tablolar</h4>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {details.manifest.tables.map((table) => (
                    <li key={table.name} className="flex justify-between gap-3">
                      <span className="truncate font-mono text-xs text-neutral-700">{table.name}{table.restore ? "" : " (yalnız kayıt)"}</span>
                      <span className="text-neutral-900">{table.rows}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Medya</h4>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {details.manifest.buckets.map((bucket) => (
                    <li key={bucket.name} className="flex justify-between gap-3">
                      <span className="truncate font-mono text-xs text-neutral-700">{bucket.name}</span>
                      <span className="text-neutral-900">{bucket.files} dosya · {formatBytes(bucket.bytes)}</span>
                    </li>
                  ))}
                </ul>
                <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Yedeğe alınmayanlar</h4>
                <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600">{details.manifest.excluded.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
          ) : null}
          {validation ? (
            <div role="status" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${validation.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} data-testid="validation-result">
              {validation.ok ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
              <span>{validation.ok ? "Yedek doğrulandı: paket, manifest ve tüm sağlama toplamları geçerli." : validation.errors.join(" ")}</span>
            </div>
          ) : null}
          {job.operation === "backup" && job.status === "succeeded" ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => void validate()} disabled={validating || !details?.fileAvailable} className={secondaryButton}>
                <ShieldCheckIcon className="size-4" aria-hidden="true" />{validating ? "Doğrulanıyor..." : "Doğrula"}
              </button>
              <button type="button" onClick={() => void download()} disabled={downloading || !details?.fileAvailable} className={secondaryButton}>
                <ArrowDownTrayIcon className="size-4" aria-hidden="true" />{downloading ? "İndiriliyor..." : "İndir"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
