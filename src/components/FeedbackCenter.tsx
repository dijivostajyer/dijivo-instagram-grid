"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
  Squares2X2Icon,
  XMarkIcon,
} from "@heroicons/react/16/solid";

import {
  CENTER_TARGET_LABELS,
  FEEDBACK_PAGE_SIZE,
  WORKFLOW_LABELS,
  WORKFLOW_STATUSES,
  buildFeedbackTimeline,
  formatFeedbackDateTime,
  sanitizeFeedbackSearch,
  type FeedbackCenterItem,
  type FeedbackCenterRecord,
  type FeedbackDetail,
  type FeedbackListQuery,
  type FeedbackPreview,
  type WorkflowStatus,
} from "@/lib/feedback-center";
import type { FeedbackCenterSource } from "@/lib/feedback-center-client";
import { gridCellAspectClass } from "@/lib/grid-ratio";
import { monthLabel } from "@/lib/project-ops";
import { withBasePath } from "@/lib/base-path";
import { FEEDBACK_ACTION_LABELS, type FeedbackAction, type FeedbackTargetType } from "@/lib/share-feedback";
import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";

export interface FeedbackTargetLink {
  brandId: string | null;
  projectId: string | null;
  targetType: FeedbackTargetType;
  targetId: string | null;
}

interface Filters {
  brandId: string;
  monthKey: string;
  targetType: FeedbackTargetType | "";
  action: FeedbackAction | "";
  workflowStatus: WorkflowStatus | "";
  unreadOnly: boolean;
  order: "desc" | "asc";
}

const EMPTY_FILTERS: Filters = { brandId: "", monthKey: "", targetType: "", action: "", workflowStatus: "", unreadOnly: false, order: "desc" };

const SHARE_STATUS_LABELS: Record<FeedbackCenterItem["share"]["status"], string> = {
  active: "Aktif",
  expired: "Süresi doldu",
  revoked: "Kaldırıldı",
  missing: "Bulunamadı",
};

function fold(value: string): string {
  return value.toLocaleLowerCase("tr-TR");
}

function monthKeyOf(project: Pick<GridProject, "month" | "year">): string {
  return `${project.year}-${String(project.month).padStart(2, "0")}`;
}

const badgeBase = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

function ActionBadge({ action }: { action: FeedbackAction }) {
  return (
    <span className={`${badgeBase} ${action === "approved" ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20" : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25"}`}>
      {FEEDBACK_ACTION_LABELS[action]}
    </span>
  );
}

const WORKFLOW_BADGE: Record<WorkflowStatus, string> = {
  new: "bg-sky-50 text-sky-800 ring-sky-600/20",
  in_review: "bg-violet-50 text-violet-800 ring-violet-600/20",
  revision_done: "bg-teal-50 text-teal-800 ring-teal-600/20",
  closed: "bg-neutral-100 text-neutral-600 ring-neutral-500/20",
};

function WorkflowBadge({ status }: { status: WorkflowStatus }) {
  return <span className={`${badgeBase} ring-1 ring-inset ${WORKFLOW_BADGE[status]}`}>{WORKFLOW_LABELS[status]}</span>;
}

function TypeBadge({ type }: { type: FeedbackTargetType }) {
  return <span className={`${badgeBase} bg-neutral-100 text-neutral-700`}>{CENTER_TARGET_LABELS[type]}</span>;
}

function aspectFor(type: FeedbackTargetType, preview: FeedbackPreview): string {
  if (type === "story") return "aspect-[9/16]";
  if (type === "grid") return "aspect-square";
  return gridCellAspectClass(type === "reel" ? "reel" : preview.postType === "reel" ? "reel" : "post");
}

/** Post 3:4, Reel 2:3, Story 9:16, Tüm Grid ikon; medya yoksa güvenli yedek. */
function FeedbackThumb({ item, size }: { item: Pick<FeedbackCenterItem, "targetType" | "preview">; size: "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const { preview, targetType } = item;
  const width = size === "sm" ? "w-16" : "w-full max-w-[16rem]";
  // self-start: kartın flex satırı küçük resmi kart yüksekliğine uzatıp
  // oranı (3:4 / 2:3 / 9:16) bozmasın.
  const frame = `${width} ${aspectFor(targetType, preview)} shrink-0 self-start overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-black/5`;
  if (preview.kind === "grid") {
    return (
      <div className={`${frame} grid place-items-center bg-gradient-to-br from-slate-50 to-slate-200 text-slate-500`} aria-label="Tüm grid">
        <div className="flex flex-col items-center gap-1 px-1 text-center">
          <Squares2X2Icon className={size === "sm" ? "size-6" : "size-10"} aria-hidden="true" />
          {size === "lg" && preview.cellCount ? <span className="text-xs font-medium">{preview.cellCount} içerik</span> : null}
        </div>
      </div>
    );
  }
  if (preview.kind === "unavailable" || !preview.url || failed) {
    return (
      <div className={`${frame} grid place-items-center p-1 text-center text-neutral-400`} data-testid="preview-fallback">
        <div className="flex flex-col items-center gap-1">
          <PhotoIcon className={size === "sm" ? "size-5" : "size-8"} aria-hidden="true" />
          <span className={size === "sm" ? "sr-only" : "text-xs"}>İçerik önizlemesi kullanılamıyor.</span>
        </div>
      </div>
    );
  }
  return (
    <div className={frame}>
      {preview.kind === "video" ? (
        <video src={preview.url} muted playsInline preload="metadata" className="size-full object-cover" onError={() => setFailed(true)} aria-label={`${CENTER_TARGET_LABELS[targetType]} önizlemesi`} />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={preview.url} alt={preview.alt ?? `${CENTER_TARGET_LABELS[targetType]} önizlemesi`} className="size-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function BrandAvatar({ brand, size }: { brand: Brand | undefined; size: string }) {
  if (brand?.profileImageUrl) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={brand.profileImageUrl} alt="" className={`${size} shrink-0 rounded-full object-cover ring-1 ring-black/10`} />;
  }
  return <span className={`${size} grid shrink-0 place-items-center rounded-full bg-neutral-200 text-[10px] font-semibold text-neutral-600`} aria-hidden="true">{(brand?.name ?? "?").charAt(0).toUpperCase()}</span>;
}

export default function FeedbackCenter({
  source,
  brands,
  projects,
  onOpenTarget,
}: {
  source: FeedbackCenterSource;
  brands: Brand[];
  /** Tüm markaların aylık planları (ay etiketi ve "Projeye Git" için). */
  projects: GridProject[];
  onOpenTarget: (target: FeedbackTargetLink) => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<FeedbackCenterItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const requestRef = useRef(0);

  const brandById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  // Arama yazarken her tuşta istek atılmaz.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const monthOptions = useMemo(() => {
    const keys = new Map<string, string>();
    for (const project of projects) {
      if (filters.brandId && project.brandId !== filters.brandId) continue;
      keys.set(monthKeyOf(project), monthLabel(project.month, project.year));
    }
    return [...keys].sort((a, b) => b[0].localeCompare(a[0]));
  }, [projects, filters.brandId]);

  const query = useMemo((): FeedbackListQuery => {
    const q = sanitizeFeedbackSearch(search);
    const needle = q ? fold(q.replace(/^@/, "")) : "";
    const qBrandIds = needle
      ? brands.filter((brand) => fold(brand.name).includes(needle) || fold(brand.username).includes(needle)).map((brand) => brand.id)
      : [];
    const projectIds = filters.monthKey
      ? projects.filter((project) => monthKeyOf(project) === filters.monthKey && (!filters.brandId || project.brandId === filters.brandId)).map((project) => project.id)
      : undefined;
    return {
      ...(filters.brandId ? { brandId: filters.brandId } : {}),
      // Seçilen ayda plan yoksa hiçbir kayıt eşleşmemeli.
      ...(projectIds ? { projectIds: projectIds.length ? projectIds : ["__yok__"] } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.workflowStatus ? { workflowStatus: filters.workflowStatus } : {}),
      ...(filters.unreadOnly ? { unreadOnly: true } : {}),
      ...(q ? { q } : {}),
      ...(qBrandIds.length ? { qBrandIds } : {}),
      order: filters.order,
      limit: FEEDBACK_PAGE_SIZE,
      offset: 0,
    };
  }, [brands, filters, projects, search]);

  const filtersActive = JSON.stringify({ ...filters, order: "desc" }) !== JSON.stringify(EMPTY_FILTERS) || Boolean(sanitizeFeedbackSearch(search));

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await source.list(query);
      if (id !== requestRef.current) return;
      setItems(result.items);
      setHasMore(result.hasMore);
      setNextOffset(result.nextOffset);
      setUnreadCount(result.unreadCount);
    } catch (caught) {
      if (id !== requestRef.current) return;
      setError(caught instanceof Error ? caught.message : "Geri dönüşler yüklenemedi.");
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [query, source]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await source.list({ ...query, offset: nextOffset });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setHasMore(result.hasMore);
      setNextOffset(result.nextOffset);
      setUnreadCount(result.unreadCount);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Geri dönüşler yüklenemedi.");
    } finally {
      setLoadingMore(false);
    }
  }

  const applyRecord = useCallback((record: Partial<FeedbackCenterRecord> & { id: string }) => {
    setItems((current) => current.map((item) => (item.id === record.id ? { ...item, ...record } : item)));
    setDetail((current) => current && {
      ...current,
      item: current.item.id === record.id ? { ...current.item, ...record } : current.item,
      history: current.history.map((entry) => (entry.id === record.id ? { ...entry, ...record } : entry)),
    });
  }, []);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    try {
      const loaded = await source.detail(id);
      setDetail(loaded);
      // Liste açılınca değil, detay görülünce okundu: bu hedefin görünen
      // okunmamış kayıtları.
      const unread = loaded.history.filter((entry) => !entry.readAt).map((entry) => entry.id);
      if (unread.length) {
        const result = await source.markRead(unread);
        const readAt = new Date().toISOString();
        for (const readId of result.ids) applyRecord({ id: readId, readAt });
        setUnreadCount(result.unreadCount);
      }
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Geri dönüş yüklenemedi.");
    }
  }, [applyRecord, source]);

  async function changeWorkflow(status: WorkflowStatus) {
    if (!detail) return;
    setWorkflowBusy(true);
    setDetailError(null);
    try {
      const record = await source.setWorkflow(detail.item.id, status);
      applyRecord(record);
      // Geçmiş ve iç olaylar sunucudan tazelenir (kayıt üzerine yazılmaz).
      setDetail(await source.detail(detail.item.id));
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Durum güncellenemedi.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value, ...(key === "brandId" ? { monthKey: "" } : {}) }));

  const selectClass = "h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-neutral-800 focus:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/30";
  const chipClass = (active: boolean) =>
    `inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${active ? "border-sky-700 bg-sky-50 text-sky-900" : "border-slate-200 bg-white text-neutral-600 hover:bg-neutral-50"}`;

  const selected = detail?.item ?? items.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">Paylaşım bağlantılarından gelen müşteri onayları ve revize talepleri.</p>
        <span className={`${badgeBase} bg-sky-50 text-sky-800`} data-testid="unread-count">{unreadCount} okunmamış</span>
      </div>

      <section aria-label="Filtreler" className="mb-5 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        <label className="relative block">
          <span className="sr-only">Ara</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Marka, @kullanıcı adı, müşteri veya mesaj ara"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/30"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <select aria-label="Marka" value={filters.brandId} onChange={(event) => setFilter("brandId", event.target.value)} className={selectClass}>
            <option value="">Tüm markalar</option>
            {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <select aria-label="Ay" value={filters.monthKey} onChange={(event) => setFilter("monthKey", event.target.value)} className={selectClass}>
            <option value="">Tüm aylar</option>
            {monthOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select aria-label="İçerik tipi" value={filters.targetType} onChange={(event) => setFilter("targetType", event.target.value as Filters["targetType"])} className={selectClass}>
            <option value="">Tüm içerikler</option>
            {(["post", "reel", "story", "grid"] as const).map((type) => <option key={type} value={type}>{CENTER_TARGET_LABELS[type]}</option>)}
          </select>
          <select aria-label="Müşteri durumu" value={filters.action} onChange={(event) => setFilter("action", event.target.value as Filters["action"])} className={selectClass}>
            <option value="">Tüm müşteri durumları</option>
            <option value="approved">{FEEDBACK_ACTION_LABELS.approved}</option>
            <option value="revision_requested">{FEEDBACK_ACTION_LABELS.revision_requested}</option>
          </select>
          <select aria-label="İş akışı durumu" value={filters.workflowStatus} onChange={(event) => setFilter("workflowStatus", event.target.value as Filters["workflowStatus"])} className={selectClass}>
            <option value="">Tüm iş akışı durumları</option>
            {WORKFLOW_STATUSES.map((status) => <option key={status} value={status}>{WORKFLOW_LABELS[status]}</option>)}
          </select>
          <select aria-label="Sıralama" value={filters.order} onChange={(event) => setFilter("order", event.target.value as Filters["order"])} className={selectClass}>
            <option value="desc">En yeni</option>
            <option value="asc">En eski</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={filters.action === "revision_requested"} onClick={() => setFilter("action", filters.action === "revision_requested" ? "" : "revision_requested")} className={chipClass(filters.action === "revision_requested")}>Yalnız revizeler</button>
          <button type="button" aria-pressed={filters.unreadOnly} onClick={() => setFilter("unreadOnly", !filters.unreadOnly)} className={chipClass(filters.unreadOnly)}>Okunmamışlar</button>
          {filtersActive ? (
            <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setSearchInput(""); setSearch(""); }} className="ml-auto h-9 rounded-lg px-3 text-sm font-medium text-sky-700 hover:bg-sky-50">Filtreleri temizle</button>
          ) : null}
        </div>
      </section>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-6">
        <section aria-label="Geri dönüş listesi" className="min-w-0">
          {error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error} <button type="button" onClick={() => void load()} className="ml-2 font-medium underline">Tekrar dene</button>
            </div>
          ) : null}
          {loading && !items.length ? <p className="py-10 text-center text-sm text-neutral-500">Geri dönüşler yükleniyor…</p> : null}
          {!loading && !error && items.length === 0 ? (
            filtersActive ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <p className="text-sm font-semibold text-neutral-800">Filtrelere uyan geri dönüş yok.</p>
                <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setSearchInput(""); setSearch(""); }} className="mt-3 text-sm font-medium text-sky-700 underline">Filtreleri temizle</button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center" data-testid="feedback-empty">
                <ChatBubbleLeftRightIcon className="mx-auto size-8 text-neutral-300" aria-hidden="true" />
                <p className="mt-3 text-base font-semibold text-neutral-900">Henüz geri dönüş yok.</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500">Paylaşım bağlantılarından gelen onay ve revize talepleri burada görüntülenir.</p>
              </div>
            )
          ) : null}

          <ul className="flex flex-col gap-2.5">
            {items.map((item) => {
              const brand = item.brandId ? brandById.get(item.brandId) : undefined;
              const project = item.projectId ? projectById.get(item.projectId) : undefined;
              const active = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openDetail(item.id)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`${brand?.name ?? "Bilinmeyen marka"}, ${project ? monthLabel(project.month, project.year) : "ay bilinmiyor"}, ${CENTER_TARGET_LABELS[item.targetType]}, ${FEEDBACK_ACTION_LABELS[item.action]}, ${WORKFLOW_LABELS[item.workflowStatus]}, ${item.clientName}${item.readAt ? "" : ", okunmamış"}`}
                    data-testid="feedback-card"
                    className={`flex w-full min-w-0 gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${active ? "border-sky-500 ring-2 ring-sky-500/20" : "border-slate-200"}`}
                  >
                    <FeedbackThumb item={item} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <BrandAvatar brand={brand} size="size-5" />
                        <span className={`truncate text-sm ${item.readAt ? "font-medium text-neutral-800" : "font-semibold text-neutral-950"}`}>{brand?.name ?? "Bilinmeyen marka"}</span>
                        <span className="shrink-0 text-xs text-neutral-500">· {project ? monthLabel(project.month, project.year) : "Ay bilinmiyor"}</span>
                        {!item.readAt ? <span className="ml-auto size-2 shrink-0 rounded-full bg-sky-600" aria-label="Okunmamış" title="Okunmamış" /> : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <TypeBadge type={item.targetType} />
                        <ActionBadge action={item.action} />
                        <WorkflowBadge status={item.workflowStatus} />
                      </div>
                      <p className="mt-1.5 line-clamp-2 break-words text-sm text-neutral-700">
                        {item.message ?? (item.action === "approved" ? "Müşteri onay verdi." : "")}
                      </p>
                      <p className="mt-1 truncate text-xs text-neutral-500">
                        {item.clientName} · <time dateTime={item.createdAt}>{formatFeedbackDateTime(item.createdAt)}</time>
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="mt-4 text-center">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60">
                {loadingMore ? "Yükleniyor…" : "Daha fazla göster"}
              </button>
            </div>
          ) : null}
        </section>

        <aside
          aria-label="Geri dönüş detayı"
          className={selectedId ? "fixed inset-0 z-50 overflow-y-auto bg-[#f5f6f8] p-4 lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:bg-transparent lg:p-0" : "hidden lg:sticky lg:top-4 lg:block"}
        >
          {selectedId ? (
            <FeedbackDetailPanel
              detail={detail}
              fallback={selected}
              error={detailError}
              busy={workflowBusy}
              brand={selected?.brandId ? brandById.get(selected.brandId) : undefined}
              project={selected?.projectId ? projectById.get(selected.projectId) : undefined}
              onClose={() => { setSelectedId(null); setDetail(null); }}
              onWorkflow={(status) => void changeWorkflow(status)}
              onOpenTarget={onOpenTarget}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-neutral-500">
              Ayrıntılarını görmek için bir geri dönüş seçin.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function FeedbackDetailPanel({
  detail,
  fallback,
  error,
  busy,
  brand,
  project,
  onClose,
  onWorkflow,
  onOpenTarget,
}: {
  detail: FeedbackDetail | null;
  fallback: FeedbackCenterItem | null;
  error: string | null;
  busy: boolean;
  brand: Brand | undefined;
  project: GridProject | undefined;
  onClose: () => void;
  onWorkflow: (status: WorkflowStatus) => void;
  onOpenTarget: (target: FeedbackTargetLink) => void;
}) {
  const item = detail?.item ?? fallback;
  const timeline = detail ? buildFeedbackTimeline(detail.history, detail.events) : [];
  if (!item) return null;
  const isRevision = item.action === "revision_requested";
  const canOpen = Boolean(project);

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" data-testid="feedback-detail">
      <header className="flex items-start gap-3">
        <BrandAvatar brand={brand} size="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-neutral-900">{brand?.name ?? "Bilinmeyen marka"}</h2>
          <p className="truncate text-sm text-neutral-500">
            {brand ? `@${brand.username}` : "Marka çalışma alanında yok"} · {project ? monthLabel(project.month, project.year) : "Ay bilinmiyor"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Detayı kapat" className="grid size-10 shrink-0 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
          <XMarkIcon className="size-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <TypeBadge type={item.targetType} />
        <ActionBadge action={item.action} />
        <WorkflowBadge status={item.workflowStatus} />
      </div>

      <div className="flex justify-center rounded-lg bg-neutral-50 p-3">
        <FeedbackThumb key={item.id} item={item} size="lg" />
      </div>

      {item.preview.caption ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Açıklama</h3>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-neutral-700">{item.preview.caption}</p>
        </section>
      ) : null}

      <section className={`rounded-lg p-3 ${isRevision ? "bg-amber-50 ring-1 ring-inset ring-amber-600/20" : "bg-emerald-50 ring-1 ring-inset ring-emerald-600/20"}`}>
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${isRevision ? "text-amber-800" : "text-emerald-800"}`}>
          {isRevision ? "Revize talebi" : "Müşteri onayı"}
        </h3>
        <p className="mt-1 whitespace-pre-line break-words text-[15px] leading-relaxed text-neutral-900" data-testid="feedback-message">
          {item.message ?? (isRevision ? "" : item.targetType === "grid" ? "Müşteri gridi onayladı." : "Müşteri bu içeriği onayladı.")}
        </p>
        <p className="mt-2 text-xs text-neutral-600">
          {item.clientName} · <time dateTime={item.createdAt}>{formatFeedbackDateTime(item.createdAt)}</time>
        </p>
      </section>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-neutral-500">Paylaşım</dt>
        <dd className="min-w-0 text-neutral-800">
          {SHARE_STATUS_LABELS[item.share.status]}
          {item.share.createdAt ? ` · ${formatFeedbackDateTime(item.share.createdAt)}` : ""}
          {item.share.status === "active" ? (
            <a href={withBasePath(`/share/${item.share.token}`)} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-medium text-sky-700 underline underline-offset-2">
              Bağlantıyı aç <ArrowTopRightOnSquareIcon className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </dd>
      </dl>

      <section aria-label="İş akışı">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Ekip iş akışı</h3>
        {isRevision && item.workflowStatus !== "revision_done" ? (
          <button
            type="button"
            onClick={() => onWorkflow("revision_done")}
            disabled={busy}
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-60"
          >
            <CheckCircleIcon className="size-4" aria-hidden="true" />
            {busy ? "Kaydediliyor…" : "Revize Tamamlandı"}
          </button>
        ) : null}
        <label className="mt-2 flex items-center gap-2 text-sm text-neutral-600">
          <span className="shrink-0">Durumu değiştir</span>
          <select
            value={item.workflowStatus}
            disabled={busy}
            onChange={(event) => onWorkflow(event.target.value as WorkflowStatus)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-neutral-800 focus:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/30 disabled:opacity-60"
          >
            {WORKFLOW_STATUSES.map((status) => <option key={status} value={status}>{WORKFLOW_LABELS[status]}</option>)}
          </select>
        </label>
        {item.workflowUpdatedAt ? <p className="mt-1.5 text-xs text-neutral-500">Son güncelleme: {formatFeedbackDateTime(item.workflowUpdatedAt)}</p> : null}
      </section>

      <section aria-label="Geçmiş">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Bu içeriğin geçmişi</h3>
        {!detail && !error ? <p className="mt-2 text-sm text-neutral-500">Yükleniyor…</p> : null}
        <ol className="mt-2 flex flex-col gap-2 border-l border-slate-200 pl-3" data-testid="feedback-timeline">
          {timeline.map((entry) =>
            entry.kind === "customer" ? (
              <li key={`c-${entry.record.id}`} className={`relative text-sm ${entry.record.id === item.id ? "font-medium" : ""}`}>
                <span className={`absolute -left-[17px] top-1.5 size-2 rounded-full ${entry.record.action === "approved" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                <time dateTime={entry.at} className="text-xs text-neutral-500">{formatFeedbackDateTime(entry.at)}</time>
                <p className="text-neutral-800">{entry.record.clientName} — {FEEDBACK_ACTION_LABELS[entry.record.action]}</p>
                {entry.record.message ? <p className="whitespace-pre-line break-words text-neutral-600">“{entry.record.message}”</p> : null}
              </li>
            ) : (
              <li key={`w-${entry.event.id}`} className="relative text-sm">
                <span className="absolute -left-[17px] top-1.5 size-2 rounded-full bg-slate-400" aria-hidden="true" />
                <time dateTime={entry.at} className="text-xs text-neutral-500">{formatFeedbackDateTime(entry.at)}</time>
                <p className="text-neutral-600">Ekip — {WORKFLOW_LABELS[entry.event.status]}</p>
              </li>
            ),
          )}
        </ol>
      </section>

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}

      <button
        type="button"
        disabled={!canOpen}
        onClick={() => onOpenTarget({ brandId: item.brandId, projectId: item.projectId, targetType: item.targetType, targetId: item.targetId })}
        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Projeye Git
      </button>
      {!canOpen ? <p className="-mt-2 text-xs text-neutral-500">Bu geri dönüşün aylık planı çalışma alanında bulunamadı.</p> : null}
    </article>
  );
}
