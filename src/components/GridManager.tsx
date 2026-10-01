"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PhotoIcon, XMarkIcon } from "@heroicons/react/16/solid";

import AppSidebar, { type AppView } from "@/components/AppSidebar";
import AppTopbar from "@/components/AppTopbar";
import BrandProfilePage from "@/components/BrandProfilePage";
import BulkCopyDialog from "@/components/BulkCopyDialog";
import DashboardOverview from "@/components/DashboardOverview";
import ExistingPostList from "@/components/ExistingPostList";
import ExportWorkspace from "@/components/ExportWorkspace";
import GridPreview from "@/components/GridPreview";
import MonthlyProjects from "@/components/MonthlyProjects";
import NewBrandModal from "@/components/NewBrandModal";
import Onboarding from "@/components/Onboarding";
import PlannedPostSorter from "@/components/PlannedPostSorter";
import PostModal from "@/components/PostModal";
import SettingsPage from "@/components/SettingsPage";
import ShareWorkspace from "@/components/ShareWorkspace";
import { useShareController } from "@/components/SharePanel";
import {
  usePersistedGrid,
  type PostCopyOptions,
} from "@/hooks/use-persisted-grid";
import { computeGrid, GRID_COLUMNS } from "@/lib/grid";
import { monthLabel } from "@/lib/project-ops";
import { type TypeFilter } from "@/lib/plan-stats";
import {
  addExistingPost,
  addPlannedPost,
  deleteExistingPost,
  deletePlannedPost,
  movePinnedPost,
  MAX_PINNED,
  pinPost,
  reorderPlannedPosts,
  reorderPinnedPosts,
  unpinPost,
} from "@/lib/post-ops";
import { loadImageFile } from "@/lib/validators";
import type { PostType } from "@/lib/types";

const PIN_LIMIT_MESSAGE = `En fazla ${MAX_PINNED} gönderi sabitlenebilir. Sabitlemek için önce pinned gönderilerden birinin sabitliğini kaldırın.`;

/**
 * Uygulama kabuğu: sidebar + topbar + görünüm yönlendirme (route yok, state var).
 *
 * Çoklu marka workspace'ı (Marka → Aylık Plan → Grid Planner):
 * tüm veri handler'larının (marka yönetimi, yükleme, pin, sıralama,
 * proje, çapraz kopya, sıfırlama, paylaşım) tek kaynağıdır; ekranlar
 * yalnızca sunumdan sorumludur. Durum `usePersistedGrid` ile kalıcıdır:
 * metaveri localStorage'da, görseller IndexedDB'de saklanır.
 * Saf durum geçişleri `lib/brand-ops.ts` içinde test edilir.
 */
export default function GridManager() {
  const {
    brand,
    existingPosts,
    plannedPosts,
    ready,
    brands,
    activeBrandId,
    createBrand,
    selectBrand,
    setBrand,
    setExistingPosts,
    setPlannedPosts,
    persistUpload,
    resetToDefaults,
    projects,
    allProjects,
    activeProjectId,
    selectProject,
    createProject,
    copyPostToProject,
    copyHighlightToBrand,
  } = usePersistedGrid();
  const [pinError, setPinError] = useState<string | null>(null);
  const [plannedError, setPlannedError] = useState<string | null>(null);
  const [mediaTab, setMediaTab] = useState<"existing" | "planned">("existing");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [bulkOpen, setBulkOpen] = useState(false);

  const grid = useMemo(
    () => computeGrid(existingPosts, plannedPosts),
    [existingPosts, plannedPosts],
  );

  // Yönetim listeleri dizi sırasını değil, mantıksal sırayı yansıtmalı:
  // planlananlar planOrder'a, mevcutlar recencyIndex'e göre listelenir.
  const sortedPlanned = useMemo(
    () => [...plannedPosts].sort((a, b) => a.planOrder - b.planOrder),
    [plannedPosts],
  );
  const sortedExisting = useMemo(
    () => [...existingPosts].sort((a, b) => a.recencyIndex - b.recencyIndex),
    [existingPosts],
  );

  async function handleExistingUpload(input: {
    url: string;
    alt: string;
    recency: "enYeni" | "enEski";
    postType: PostType;
    aspectRatio: "1:1" | "3:4" | "4:3" | "16:9";
  }) {
    // Görsel önce IndexedDB'ye yazılır; state'e `blob:` URL girer, kalıcı
    // metaveriye `idb:` referansı girer.
    await persistUpload(input.url);
    const { posts } = addExistingPost(existingPosts, {
      imageUrl: input.url,
      alt: input.alt,
      recency: input.recency,
      postType: input.postType,
      aspectRatio: input.aspectRatio,
    });
    setExistingPosts(posts);
  }

  function handleDeleteExisting(id: string) {
    setExistingPosts((prev) => deleteExistingPost(prev, id));
    setSelectedPostId((current) => (current === id ? null : current));
  }

  function handleExistingPostTypeChange(id: string, postType: PostType) {
    setExistingPosts((posts) => posts.map((post) => post.id === id ? { ...post, postType } : post));
  }

  function handleTogglePin(id: string, pinned: boolean) {
    setPinError(null);
    if (pinned) {
      setExistingPosts((prev) => unpinPost(prev, id));
      return;
    }
    const pinnedCount = existingPosts.filter((p) => p.pinned).length;
    if (pinnedCount >= MAX_PINNED) {
      setPinError(PIN_LIMIT_MESSAGE);
      return;
    }
    const { posts, error } = pinPost(existingPosts, id);
    if (error) {
      setPinError(error);
      return;
    }
    setExistingPosts(posts);
  }

  function handleMovePinned(id: string, direction: -1 | 1) {
    setExistingPosts((prev) => movePinnedPost(prev, id, direction));
  }

  async function handlePlannedUpload(url: string, alt: string, postType: PostType, aspectRatio: "1:1" | "3:4" | "4:3" | "16:9") {
    setPlannedError(null);
    await persistUpload(url);
    setPlannedPosts((prev) => addPlannedPost(prev, { imageUrl: url, alt, postType, aspectRatio }).posts);
  }

  function handlePlannedPostTypeChange(id: string, postType: PostType) {
    setPlannedPosts((posts) => posts.map((post) => post.id === id ? { ...post, postType } : post));
  }

  function handleDeletePlanned(id: string) {
    setPlannedPosts((prev) => deletePlannedPost(prev, id));
    setSelectedPostId((current) => (current === id ? null : current));
  }

  function handleReorderPlanned(orderedIds: string[]) {
    setPlannedError(null);
    setPlannedPosts((prev) => reorderPlannedPosts(prev, orderedIds));
  }

  const canPinMore = grid.pinnedCount < MAX_PINNED;
  const selectedExisting = existingPosts.find((post) => post.id === selectedPostId);
  const selectedPlanned = plannedPosts.find((post) => post.id === selectedPostId);
  const selectedPost = selectedExisting ?? selectedPlanned ?? null;
  const selectedCellIndex = selectedPost
    ? grid.cells.findIndex((cell) => cell.post.id === selectedPostId)
    : -1;

  const activeProject = projects.find((project) => project.id === activeProjectId);

  // §10: caption düzenlemesi seçili gönderinin kaynağına göre
  // mevcut/planlanan dizisine yazılır.
  function handleCaptionChange(caption: string) {
    if (selectedExisting) {
      setExistingPosts((posts) =>
        posts.map((post) => (post.id === selectedExisting.id ? { ...post, caption } : post)),
      );
    } else if (selectedPlanned) {
      setPlannedPosts((posts) =>
        posts.map((post) => (post.id === selectedPlanned.id ? { ...post, caption } : post)),
      );
    }
  }

  // §12: görsel değiştirme — yeni Blob önce IndexedDB'ye kalıcılaştırılır,
  // sonra gönderinin imageUrl'i güncellenir (eski görsel yaşam döngüsü
  // tarafından temizlenir).
  async function handleChangePostImage(url: string) {
    await persistUpload(url);
    if (selectedExisting) {
      setExistingPosts((posts) =>
        posts.map((post) =>
          post.id === selectedExisting.id ? { ...post, imageUrl: url } : post,
        ),
      );
    } else if (selectedPlanned) {
      setPlannedPosts((posts) =>
        posts.map((post) =>
          post.id === selectedPlanned.id ? { ...post, imageUrl: url } : post,
        ),
      );
    }
  }

  // §16: gönderiyi başka bir aylık plana (aynı veya başka marka) kopyalar.
  function handleCopyPost(targetProjectId: string, options: PostCopyOptions) {
    if (!selectedPost) return null;
    return copyPostToProject(selectedPost.id, targetProjectId, options);
  }

  // §18: medya panelindeki çoklu seçim ve toplu kopya.
  function handleToggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function handleBulkCopy(
    targetProjectId: string,
    options: PostCopyOptions,
  ): string {
    const liveIds = new Set(existingPosts.map((post) => post.id));
    const ids = sortedExisting
      .map((post) => post.id)
      .filter((id) => selectedIds.has(id) && liveIds.has(id));
    let copied = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const error = copyPostToProject(id, targetProjectId, options);
      if (error) errors.push(error);
      else copied += 1;
    }
    setSelectedIds(new Set());
    setSelectionMode(false);
    if (errors.length > 0) {
      return `${copied} gönderi kopyalandı; ${errors.length} gönderi kopyalanamadı (${errors[0]}).`;
    }
    return `${copied} gönderi kopyalandı.`;
  }

  async function handleReset() {
    const confirmed = window.confirm(
      "Tüm markalar, aylık planlar, görseller ve yüklenen dosyalar kalıcı olarak silinecek ve ilk açılış ekranına (marka oluşturma) dönülecek. Devam edilsin mi?",
    );
    if (!confirmed) return;
    await resetToDefaults();
    setPinError(null);
    setPlannedError(null);
    setSelectedPostId(null);
  }

  // Export, UI'da görülen sırayı aynen almalı: grid cell'lerindeki imageUrl'ler.
  const imageUrls = useMemo(
    () => grid.cells.map((cell) => Promise.resolve(cell.post.imageUrl)),
    [grid],
  );

  const exportOptions = {
    download: async (fileName: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    showError: (message: string) => console.error("[export]", message),
  };

  // Bağlantı durumu kabukta tutulur: Paylaşım ekranından çıkınca kaybolmaz.
  const shareController = useShareController(brand, grid);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  // §18: çoklu seçim yalnızca aktif projeye aittir; proje
  // değişince başka projenin post ID'leri anlamsız olur.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [activeProjectId]);

  function navigate(next: AppView) {
    setView(next);
    setSidebarOpen(false);
  }

  function openProject(id: string) {
    selectProject(id);
    setSelectedPostId(null);
    setView("planner");
  }

  // §2/§22: kayıtlı veri yüklenene kadar bekleme; henüz marka yoksa
  // onboarding ekranı gösterilir (gerçek workspace başlayamaz).
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm text-neutral-500">Yükleniyor…</p>
      </div>
    );
  }
  if (brands.length === 0 || !activeBrandId) {
    return <Onboarding onCreate={createBrand} />;
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-neutral-900">
      <div className="lg:flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">
          <AppSidebar view={view} onNavigate={navigate} />
        </aside>

        <div className="min-w-0 flex-1">
          <AppTopbar
            view={view}
            brands={brands}
            activeBrandId={activeBrandId}
            onSelectBrand={(id) => {
              selectBrand(id);
              setSelectedPostId(null);
            }}
            onNewBrand={() => setNewBrandOpen(true)}
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={(id) => {
              selectProject(id);
              setSelectedPostId(null);
            }}
            onOpenSidebar={() => setSidebarOpen(true)}
          />

          <main className="px-4 py-6 sm:px-6 lg:py-8">
            {view === "overview" ? (
              <DashboardOverview
                brand={brand}
                result={grid}
                existingCount={existingPosts.length}
                plannedCount={plannedPosts.length}
                projects={projects}
                activeProjectId={activeProjectId}
                shareLink={shareController.link}
                onOpenProject={openProject}
                onNavigate={navigate}
              />
            ) : null}

            {view === "plans" ? (
              <MonthlyProjects
                projects={projects}
                activeProjectId={activeProjectId}
                shareLink={shareController.link}
                onSelect={(id) => {
                  selectProject(id);
                  setSelectedPostId(null);
                }}
                onOpen={openProject}
                onCreate={(name, month, year, copyPrevious) => {
                  const error = createProject(name, month, year, copyPrevious);
                  if (!error) {
                    setSelectedPostId(null);
                    setView("planner");
                  }
                  return error;
                }}
              />
            ) : null}

            {view === "planner" ? (
              <>
              {/* Kompakt çalışma çubuğu: aktif proje ve gerçek sayılar */}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-neutral-900">
                    {activeProject?.name ?? "Aktif proje"}
                  </span>
                  {activeProject ? (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      {monthLabel(activeProject.month, activeProject.year)}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded-full bg-neutral-100 px-2 py-1 font-medium text-neutral-700">{grid.cells.length} içerik</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-1 font-medium text-neutral-700">{existingPosts.length} mevcut</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-1 font-medium text-neutral-700">{plannedPosts.length} planlanan</span>
                  <span className="rounded-full bg-sky-50 px-2 py-1 font-medium text-sky-800">{grid.pinnedCount}/3 pinned</span>
                </div>
              </div>
              <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
                {/* Sol panel: mevcut/planlanan içerik yönetimi */}
                <aside className="order-2 min-w-0 xl:order-none xl:border-r xl:border-slate-200 xl:pr-6">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-neutral-900">İçerikler</h2>
                    <div className="flex items-center gap-2">
                      {mediaTab === "existing" ? (
                        <button
                          type="button"
                          onClick={() =>
                            selectionMode
                              ? handleExitSelectionMode()
                              : setSelectionMode(true)
                          }
                          aria-pressed={selectionMode}
                          className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 aria-pressed:border-sky-700 aria-pressed:bg-sky-50 aria-pressed:text-sky-800"
                        >
                          Çoklu seçim
                        </button>
                      ) : null}
                      <PhotoIcon className="size-4 text-neutral-400" aria-hidden="true" />
                    </div>
                  </div>
                  <div role="tablist" className="mb-4 flex border-b border-slate-200 text-sm">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mediaTab === "existing"}
                      onClick={() => {
                        setMediaTab("existing");
                        handleExitSelectionMode();
                      }}
                      className={`-mb-px border-b-2 px-3 py-2 font-medium ${mediaTab === "existing" ? "border-sky-700 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-900"}`}
                    >
                      Mevcut <span className="text-neutral-400">{existingPosts.length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mediaTab === "planned"}
                      onClick={() => {
                        setMediaTab("planned");
                        handleExitSelectionMode();
                      }}
                      className={`-mb-px border-b-2 px-3 py-2 font-medium ${mediaTab === "planned" ? "border-sky-700 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-900"}`}
                    >
                      Planlanan <span className="text-neutral-400">{plannedPosts.length}</span>
                    </button>
                  </div>
                  {mediaTab === "existing" ? (
                    <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="İçerik türü filtresi">
                      {([["all", "Tümü"], ["post", "Post"], ["reel", "Reel"], ["carousel", "Carousel"]] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTypeFilter(value)}
                          aria-pressed={typeFilter === value}
                          className={`h-7 rounded-full px-2.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                            typeFilter === value
                              ? "bg-neutral-900 text-white"
                              : "border border-slate-200 bg-white text-neutral-600 hover:bg-neutral-50"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {mediaTab === "existing" ? (
                    <>
                    <ExistingPostList
                      posts={sortedExisting}
                      typeFilter={typeFilter}
                      pinnedCount={grid.pinnedCount}
                      pinError={pinError}
                      onUpload={handleExistingUpload}
                      onDelete={handleDeleteExisting}
                      onTogglePin={handleTogglePin}
                      onMovePinned={handleMovePinned}
                      onPostTypeChange={handleExistingPostTypeChange}
                      onSelect={(id) => setSelectedPostId(id)}
                      selectionMode={selectionMode}
                      selectedIds={selectedIds}
                      onToggleSelect={handleToggleSelect}
                    />
                    {selectionMode ? (
                      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                        <span className="text-sm font-medium text-sky-900">
                          {selectedIds.size} gönderi seçildi
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedIds(new Set())}
                            className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                          >
                            Temizle
                          </button>
                          <button
                            type="button"
                            disabled={selectedIds.size === 0}
                            onClick={() => setBulkOpen(true)}
                            className="h-7 rounded-lg bg-sky-700 px-2.5 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                          >
                            Kopyala
                          </button>
                        </div>
                      </div>
                    ) : null}
                    </>
                  ) : (
                    <section>
                      <PlannedUpload onUpload={handlePlannedUpload} />
                      {plannedError ? <p role="alert" className="mt-3 text-sm text-red-700">{plannedError}</p> : null}
                      {plannedPosts.length === 0 ? (
                        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-neutral-500">
                          Henüz planlanan gönderi yok.<br />İlk görselinizi yükleyin.
                        </div>
                      ) : (
                        <div className="mt-4">
                          <p className="mb-3 text-sm text-neutral-500">
                            Tutamacı sürükleyerek yayın sırasını değiştirin.
                          </p>
                          <PlannedPostSorter
                            posts={sortedPlanned}
                            onReorder={handleReorderPlanned}
                            onDelete={handleDeletePlanned}
                            onPostTypeChange={handlePlannedPostTypeChange}
                            onSelect={(id) => setSelectedPostId(id)}
                          />
                        </div>
                      )}
                    </section>
                  )}
                </aside>

                {/* Orta alan: Instagram grid önizlemesi ekranın ana odağı */}
                <section className="order-1 min-w-0 xl:order-none">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-neutral-900">
                        Instagram önizlemesi
                      </h2>
                      <p className="mt-1 truncate text-sm text-neutral-500">
                        {activeProject ? `${activeProject.name} · planlanan içerikler yayın sırasına göre görünür.` : "Planlanan içerikler gridde yayın sırasına göre görünür."}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigate("profile")}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                      >
                        Öne Çıkanları Düzenle
                      </button>
                      <span className="hidden rounded-full bg-sky-50 px-2.5 py-1 text-sm font-medium text-sky-800 sm:inline">
                        3 sütun
                      </span>
                    </div>
                  </div>
                  {canPinMore ? null : (
                    <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Sabitlenmiş gönderi limiti dolu. Yeni bir pin için önce birini kaldırın.
                    </p>
                  )}
                  {grid.cells.length === 0 ? (
                    <div className="grid min-h-96 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                      <div>
                        <PhotoIcon className="mx-auto mb-3 size-6 text-neutral-400" aria-hidden="true" />
                        <h3 className="font-semibold">Grid henüz boş</h3>
                        <p className="mt-1 max-w-xs text-sm text-neutral-500">
                          Sol panelden mevcut veya planlanan bir görsel ekleyerek başlayın.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <GridPreview
                      brand={brand}
                      result={grid}
                      selectedPostId={selectedPostId}
                      onSelectPost={setSelectedPostId}
                    />
                  )}
                  <p className="mt-3 text-sm text-neutral-500">
                    Görseller Instagram profilindeki gibi merkezden 1:1 kırpılır ({GRID_COLUMNS} sütun).
                  </p>
                </section>
              </div>
              </>
            ) : null}

            {view === "profile" ? (
              <BrandProfilePage
                brand={brand}
                onChange={setBrand}
                brands={brands}
                onCopyHighlight={copyHighlightToBrand}
              />
            ) : null}

            {view === "share" ? (
              <ShareWorkspace result={grid} controller={shareController} />
            ) : null}

            {view === "export" ? (
              <ExportWorkspace
                brand={brand}
                result={grid}
                imageUrls={imageUrls}
                options={exportOptions}
                projectLabel={
                  activeProject
                    ? `${activeProject.name} · ${activeProject.month}/${activeProject.year}`
                    : "—"
                }
              />
            ) : null}

            {view === "settings" ? (
              <SettingsPage projectCount={projects.length} onReset={() => void handleReset()} />
            ) : null}
          </main>
        </div>
      </div>

      {/* §11/§12: seçili içeriğin düzenleme modalı (sağ panel yerine
          ortalanmış diyalog). Grid hücresi veya içerik listesi tıklamasıyla
          açılır. */}
      {selectedPost ? (
        <PostModal
          post={selectedPost}
          source={selectedExisting ? "mevcut" : "planlanan"}
          brand={brand}
          gridPosition={
            selectedCellIndex >= 0
              ? { index: selectedCellIndex + 1, total: grid.cells.length }
              : null
          }
          allProjects={allProjects}
          brands={brands}
          onPostTypeChange={(postType) => {
            if (selectedExisting) {
              handleExistingPostTypeChange(selectedExisting.id, postType);
            } else if (selectedPlanned) {
              handlePlannedPostTypeChange(selectedPlanned.id, postType);
            }
          }}
          onCaptionChange={handleCaptionChange}
          onTogglePin={
            selectedExisting
              ? () => handleTogglePin(selectedExisting.id, selectedExisting.pinned)
              : undefined
          }
          onMovePinned={
            selectedExisting?.pinned
              ? (direction) => handleMovePinned(selectedExisting.id, direction)
              : undefined
          }
          onDelete={
            selectedExisting
              ? () => handleDeleteExisting(selectedExisting.id)
              : selectedPlanned
                ? () => handleDeletePlanned(selectedPlanned.id)
                : undefined
          }
          onChangeImage={handleChangePostImage}
          onCopy={handleCopyPost}
          onClose={() => setSelectedPostId(null)}
        />
      ) : null}

      {/* §18: toplu gönderi kopyalama diyalogu */}
      {bulkOpen ? (
        <BulkCopyDialog
          count={selectedIds.size}
          allProjects={allProjects}
          brands={brands}
          onClose={() => setBulkOpen(false)}
          onSubmit={handleBulkCopy}
        />
      ) : null}

      {/* §3: '+ Yeni Marka' diyalogu */}
      {newBrandOpen ? (
        <NewBrandModal
          onClose={() => setNewBrandOpen(false)}
          onCreate={createBrand}
        />
      ) : null}

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <button
              type="button"
              aria-label="Menüyü kapat"
              autoFocus
              onClick={() => setSidebarOpen(false)}
              className="absolute right-2 top-3 z-10 grid size-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <XMarkIcon className="size-4" aria-hidden="true" />
            </button>
            <AppSidebar view={view} onNavigate={navigate} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Planlanan gönderi yükleme formu (hata mesajlarıyla). */
function PlannedUpload({
  onUpload,
}: {
  onUpload: (url: string, alt: string, postType: PostType, aspectRatio: "1:1" | "3:4" | "4:3" | "16:9") => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postType, setPostType] = useState<PostType>("post");

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const { url, alt, aspectRatio } = await loadImageFile(file);
        await onUpload(url, alt, postType, aspectRatio);
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "Görsel yüklenemedi."}`);
      }
    }
    if (failures.length) {
      setError(failures.join(" "));
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {busy ? "Yükleniyor…" : "Görsel yükle"}
        </button>
        <select
          aria-label="Planlanan içerik türü"
          value={postType}
          onChange={(event) => setPostType(event.target.value as PostType)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
        >
          <option value="post">Post</option>
          <option value="reel">Reel</option>
          <option value="carousel">Carousel</option>
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
