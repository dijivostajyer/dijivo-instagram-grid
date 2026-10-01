"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowPathIcon,
  CheckIcon,
  Cog6ToothIcon,
  PhotoIcon,
  Squares2X2Icon,
  XMarkIcon,
} from "@heroicons/react/16/solid";

import BrandEditor from "@/components/BrandEditor";
import ExistingPostList from "@/components/ExistingPostList";
import ExportPanel from "@/components/ExportPanel";
import GridPreview from "@/components/GridPreview";
import PlannedPostSorter from "@/components/PlannedPostSorter";
import SharePanel from "@/components/SharePanel";
import { usePersistedGrid } from "@/hooks/use-persisted-grid";
import { computeGrid, GRID_COLUMNS } from "@/lib/grid";
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
 * MVP ikinci aşama ekranı: marka düzenleme, mevcut/planlanan gönderi yönetimi,
 * pinned yönetimi, anında güncellenen 3 sütunlu grid önizlemesi ve PDF/JPG dışa
 * aktarma alanı.
 * Durum `usePersistedGrid` ile kalıcıdır: metaveri localStorage'da, yüklenen
 * görseller IndexedDB'de saklanır; yenilemede ve tarayıcı yeniden açılışında
 * korunur. "Verileri sıfırla" demo verilere döner.
 */
export default function GridManager() {
  const {
    brand,
    existingPosts,
    plannedPosts,
    setBrand,
    setExistingPosts,
    setPlannedPosts,
    persistUpload,
    resetToDefaults,
    projects,
    activeProjectId,
    selectProject,
    createProject,
  } = usePersistedGrid();
  const [pinError, setPinError] = useState<string | null>(null);
  const [plannedError, setPlannedError] = useState<string | null>(null);
  const [mediaTab, setMediaTab] = useState<"existing" | "planned">("existing");
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

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

  function handleReorderPinned(orderedIds: string[]) {
    setExistingPosts((prev) => reorderPinnedPosts(prev, orderedIds));
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
  }

  function handleReorderPlanned(orderedIds: string[]) {
    setPlannedError(null);
    setPlannedPosts((prev) => reorderPlannedPosts(prev, orderedIds));
  }

  const canPinMore = grid.pinnedCount < MAX_PINNED;
  const selectedExisting = existingPosts.find((post) => post.id === selectedPostId);
  const selectedPlanned = plannedPosts.find((post) => post.id === selectedPostId);
  const selectedPost = selectedExisting ?? selectedPlanned;

  async function handleReset() {
    const confirmed = window.confirm(
      "Tüm değişiklikler ve yüklenen görseller kalıcı olarak silinip demo verilere dönülecek. Devam edilsin mi?",
    );
    if (!confirmed) return;
    await resetToDefaults();
    setPinError(null);
    setPlannedError(null);
  }
  // Export, UI'da görülen sırayı aynen almalı: grid cellsdeki imageUrl'ler.
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

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [profileOpen]);

  return (
    <div className="min-h-screen bg-[#f6f7f5] text-neutral-900">
      <header className="border-b border-black/5 bg-white/90">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-900 text-sm font-semibold text-white">D</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Dijivo Grid</p>
              <p className="hidden text-sm text-neutral-500 sm:block">Instagram Grid Planner</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-neutral-500 md:flex">
            <CheckIcon className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            Tarayıcınıza kaydedildi
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Profil ayarları" onClick={() => setProfileOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
              <Cog6ToothIcon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Profil ayarları</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:py-7">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-neutral-500">Aktif marka</p>
            <h1 className="text-2xl font-semibold tracking-tight">{brand.name || "İsimsiz marka"}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-500"><Squares2X2Icon className="size-4" /> {grid.cells.length} içerik · {grid.pinnedCount} sabit</div>
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-white p-3">
          <label className="text-sm font-medium" htmlFor="project-select">Aylık proje</label>
          <select id="project-select" value={activeProjectId} onChange={(event) => selectProject(event.target.value)} className="rounded-lg border border-black/10 px-2 py-1.5 text-sm">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.month}/{project.year}</option>)}
          </select>
          <button type="button" onClick={() => setNewProjectOpen((open) => !open)} className="rounded-lg border border-black/10 px-2 py-1.5 text-sm font-medium hover:bg-neutral-50">Yeni ay</button>
          {newProjectOpen ? <ProjectCreator onCreate={(name, month, year, copyPrevious) => { const error = createProject(name, month, year, copyPrevious); setProjectError(error); if (!error) setNewProjectOpen(false); }} /> : null}
          {projectError ? <p role="alert" className="text-sm text-red-700">{projectError}</p> : null}
        </div>

        <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
          <aside className="order-2 min-w-0 border-b border-black/10 pb-6 xl:order-none xl:border-b-0 xl:border-r xl:pr-6 xl:pb-0">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">İçerikler</h2><PhotoIcon className="size-4 text-neutral-400" /></div>
            <div role="tablist" className="mb-4 flex border-b border-black/10 text-sm">
              <button type="button" role="tab" aria-selected={mediaTab === "existing"} onClick={() => setMediaTab("existing")} className={`-mb-px border-b-2 px-3 py-2 font-medium ${mediaTab === "existing" ? "border-sky-700 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-900"}`}>Mevcut <span className="text-neutral-400">{existingPosts.length}</span></button>
              <button type="button" role="tab" aria-selected={mediaTab === "planned"} onClick={() => setMediaTab("planned")} className={`-mb-px border-b-2 px-3 py-2 font-medium ${mediaTab === "planned" ? "border-sky-700 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-900"}`}>Planlanan <span className="text-neutral-400">{plannedPosts.length}</span></button>
            </div>
            {mediaTab === "existing" ? <ExistingPostList posts={sortedExisting} pinnedCount={grid.pinnedCount} pinError={pinError} onUpload={handleExistingUpload} onDelete={handleDeleteExisting} onTogglePin={handleTogglePin} onMovePinned={handleMovePinned} onPostTypeChange={handleExistingPostTypeChange} /> : (
              <section>
                <PlannedUpload onUpload={handlePlannedUpload} />
                {plannedError ? <p role="alert" className="mt-3 text-sm text-red-700">{plannedError}</p> : null}
                {plannedPosts.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-black/15 p-5 text-center text-sm text-neutral-500">Henüz planlanan gönderi yok.<br />İlk görselinizi yükleyin.</div> : <div className="mt-4"><p className="mb-3 text-sm text-neutral-500">Tutamacı sürükleyerek yayın sırasını değiştirin.</p><PlannedPostSorter posts={sortedPlanned} onReorder={handleReorderPlanned} onDelete={handleDeletePlanned} onPostTypeChange={handlePlannedPostTypeChange} /></div>}
              </section>
            )}
          </aside>

          <section className="order-1 min-w-0 xl:order-none xl:px-2">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Instagram önizlemesi</h2><p className="mt-1 text-sm text-neutral-500">Planlanan içerikler gridde yayın sırasına göre görünür.</p></div><span className="hidden rounded-full bg-sky-50 px-2.5 py-1 text-sm font-medium text-sky-800 sm:inline">3 sütun</span></div>
            {canPinMore ? null : <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Sabitlenmiş gönderi limiti dolu. Yeni bir pin için önce birini kaldırın.</p>}
            {grid.cells.length === 0 ? <div className="grid min-h-96 place-items-center rounded-2xl border border-dashed border-black/15 bg-white p-8 text-center"><div><PhotoIcon className="mx-auto mb-3 size-6 text-neutral-400" /><h3 className="font-semibold">Grid henüz boş</h3><p className="mt-1 max-w-xs text-sm text-neutral-500">Sol panelden mevcut veya planlanan bir görsel ekleyerek başlayın.</p></div></div> : <div className="rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,.06),0_2px_8px_rgba(0,0,0,.04)] sm:p-6"><GridPreview brand={brand} result={grid} selectedPostId={selectedPostId} onSelectPost={setSelectedPostId} /></div>}
            <p className="mt-3 text-sm text-neutral-500">Görseller Instagram profilindeki gibi merkezden 1:1 kırpılır ({GRID_COLUMNS} sütun).</p>
          </section>

          <aside className="order-3 min-w-0 border-t border-black/10 pt-6 xl:order-none xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0">
            <section className="border-b border-black/10 pb-5"><h2 className="text-sm font-semibold">Paylaş ve dışa aktar</h2><div className="mt-3"><SharePanel brand={brand} result={grid} compact /></div><div className="mt-3"><ExportPanel brand={brand} result={grid} imageUrls={imageUrls} options={exportOptions} compact /></div></section>
            <section className="py-5"><h2 className="text-sm font-semibold">Seçili içerik</h2>{selectedPost ? <div className="mt-3"><img src={selectedPost.imageUrl} alt="" className="aspect-square w-full rounded-xl object-cover outline-1 -outline-offset-1 outline-black/10" /><p className="mt-3 truncate text-sm font-medium">{selectedPost.alt ?? "Görsel"}</p><p className="mt-1 text-sm text-neutral-500">{selectedExisting ? (selectedExisting.pinned ? "Sabitlenmiş mevcut gönderi" : "Mevcut gönderi") : "Planlanan gönderi"}</p>{selectedExisting ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => handleTogglePin(selectedExisting.id, selectedExisting.pinned)} className="h-9 rounded-lg border border-black/10 px-3 text-sm font-medium hover:bg-neutral-50">{selectedExisting.pinned ? "Pin kaldır" : "Pinle"}</button><button type="button" onClick={() => handleDeleteExisting(selectedExisting.id)} className="h-9 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50">Sil</button></div> : selectedPlanned ? <button type="button" onClick={() => handleDeletePlanned(selectedPlanned.id)} className="mt-3 h-9 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50">Sil</button> : null}</div> : <p className="mt-2 text-sm text-neutral-500">Gridden bir görsel seçerek ayrıntı ve hızlı aksiyonları görüntüleyin.</p>}</section>
            <section className="border-t border-black/10 pt-5"><p className="text-sm font-medium text-neutral-700">Tehlikeli alan</p><p className="mt-1 text-sm text-neutral-500">Tüm yerel verileri silip demo duruma döner.</p><button type="button" onClick={() => void handleReset()} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50"><ArrowPathIcon className="size-4" /> Demo verilere dön</button></section>
          </aside>
        </div>
      </main>

      {profileOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-black/20 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Profil ayarları"><div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl sm:rounded-2xl"><div className="mb-6 flex items-center justify-between"><div><h2 className="text-lg font-semibold">Profil ayarları</h2><p className="mt-1 text-sm text-neutral-500">Değişiklikler otomatik kaydedilir.</p></div><button type="button" autoFocus onClick={() => setProfileOpen(false)} aria-label="Profil ayarlarını kapat" className="grid size-9 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100"><XMarkIcon className="size-4" /></button></div><BrandEditor brand={brand} onChange={setBrand} /></div></div> : null}
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
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {busy ? "Yükleniyor…" : "Görsel yükle"}
      </button>
      <select aria-label="Planlanan içerik türü" value={postType} onChange={(event) => setPostType(event.target.value as PostType)} className="ml-2 h-9 rounded-lg border border-black/10 bg-white px-2 text-sm">
        <option value="post">Post</option><option value="reel">Reel</option><option value="carousel">Carousel</option>
      </select>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ProjectCreator({ onCreate }: { onCreate: (name: string, month: number, year: number, copyPrevious: boolean) => void }) {
  const now = new Date();
  const [name, setName] = useState("");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [copyPrevious, setCopyPrevious] = useState(false);
  return <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onCreate(name, month, year, copyPrevious); }}>
    <input aria-label="Proje adı" value={name} onChange={(event) => setName(event.target.value)} placeholder="Proje adı" className="w-28 rounded-lg border border-black/10 px-2 py-1.5 text-sm" />
    <input aria-label="Ay" type="number" min="1" max="12" value={month} onChange={(event) => setMonth(Number(event.target.value))} className="w-14 rounded-lg border border-black/10 px-2 py-1.5 text-sm" />
    <input aria-label="Yıl" type="number" min="2020" value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-20 rounded-lg border border-black/10 px-2 py-1.5 text-sm" />
    <label className="text-sm"><input type="checkbox" checked={copyPrevious} onChange={(event) => setCopyPrevious(event.target.checked)} /> Öncekini kopyala</label>
    <button type="submit" className="rounded-lg bg-neutral-900 px-2 py-1.5 text-sm font-medium text-white">Oluştur</button>
  </form>;
}
