"use client";

import { useMemo, useRef, useState } from "react";

import BrandEditor from "@/components/BrandEditor";
import ExistingPostList from "@/components/ExistingPostList";
import ExportPanel from "@/components/ExportPanel";
import GridPreview from "@/components/GridPreview";
import PlannedPostSorter from "@/components/PlannedPostSorter";
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
  } = usePersistedGrid();
  const [pinError, setPinError] = useState<string | null>(null);
  const [plannedError, setPlannedError] = useState<string | null>(null);

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
  }) {
    // Görsel önce IndexedDB'ye yazılır; state'e `blob:` URL girer, kalıcı
    // metaveriye `idb:` referansı girer.
    await persistUpload(input.url);
    const { posts } = addExistingPost(existingPosts, {
      imageUrl: input.url,
      alt: input.alt,
      recency: input.recency,
    });
    setExistingPosts(posts);
  }

  function handleDeleteExisting(id: string) {
    setExistingPosts((prev) => deleteExistingPost(prev, id));
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

  async function handlePlannedUpload(url: string, alt: string) {
    setPlannedError(null);
    await persistUpload(url);
    setPlannedPosts((prev) => addPlannedPost(prev, { imageUrl: url, alt }).posts);
  }

  function handleDeletePlanned(id: string) {
    setPlannedPosts((prev) => deletePlannedPost(prev, id));
  }

  function handleReorderPlanned(orderedIds: string[]) {
    setPlannedError(null);
    setPlannedPosts((prev) => reorderPlannedPosts(prev, orderedIds));
  }

  const canPinMore = grid.pinnedCount < MAX_PINNED;

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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-xl font-bold">
        Dijivo Instagram Grid Preview
      </h1>
      <p className="mb-6 text-xs text-neutral-500">
        Marka bilgilerini düzenleyin, mevcut ve planlanan gönderileri yönetin;
        sonuç anında 3 sütunlu profil gridinde görünür. Değişiklikler ve
        yüklenen görseller tarayıcınızda saklanır; yenilemede kaybolmaz.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <BrandEditor brand={brand} onChange={setBrand} />

          <ExistingPostList
            posts={sortedExisting}
            pinnedCount={grid.pinnedCount}
            pinError={pinError}
            onUpload={handleExistingUpload}
            onDelete={handleDeleteExisting}
            onTogglePin={handleTogglePin}
            onMovePinned={handleMovePinned}
          />

          <section className="rounded-lg border border-neutral-200 p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Planlanan Gönderiler
            </h2>
            <PlannedUpload onUpload={handlePlannedUpload} />
            {plannedError ? (
              <p role="alert" className="mb-2 text-xs font-medium text-red-600">
                {plannedError}
              </p>
            ) : null}
            {plannedPosts.length === 0 ? (
              <p className="mt-3 rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">
                Henüz planlanan gönderi yok.
              </p>
            ) : (
              <div className="mt-3">
                <p className="mb-2 text-[11px] text-neutral-500">
                  Sıralamak için tutamaçtan (⠿) sürükleyin; üstteki ilk
                  yayınlanacak gönderidir.
                </p>
                <PlannedPostSorter
                  posts={sortedPlanned}
                  onReorder={handleReorderPlanned}
                  onDelete={handleDeletePlanned}
                />
              </div>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-neutral-200 p-4">
            {grid.cells.length === 0 ? (
              <div className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
                Henüz gönderi yok. Sol taraftan mevcut veya planlanan içerik
                ekleyin; grid burada görünür.
              </div>
            ) : (
              <>
                {canPinMore ? null : (
                  <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                    Pinned limiti dolu ({MAX_PINNED}/{MAX_PINNED}). Yeni pin için
                    önce birini kaldırın.
                  </p>
                )}
                <GridPreview brand={brand} result={grid} />
              </>
            )}
            <p className="mt-3 text-[11px] text-neutral-400">
              Hücreler Instagram profilindeki gibi 1:1 kırpılır
              ({GRID_COLUMNS} sütun).
            </p>
          </div>
        </div>

        <div className="mx-auto mt-6 w-full max-w-2xl lg:mt-0 lg:self-start">
          <ExportPanel
            brand={brand}
            result={grid}
            imageUrls={imageUrls}
            options={{
              download: async (fileName, blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              },
              showError: (message) => {
                // Inline error is rendered by ExportPanel; a blocking alert()
                // would freeze the UI thread during export failures.
                console.error("[export]", message);
              },
            }}
          />

          <section className="mt-4 rounded-lg border border-neutral-200 p-4">
            <h2 className="mb-2 text-sm font-semibold">Veriler</h2>
            <p className="mb-3 text-xs text-neutral-500">
              Marka bilgileri, gönderiler, sıralamalar ve yüklenen görseller bu
              tarayıcıda saklanır (localStorage + IndexedDB). Sıfırlama demo
              verilere döner ve kayıtlı verileri siler.
            </p>
            <button
              type="button"
              onClick={() => void handleReset()}
              className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Verileri sıfırla (demo verilere dön)
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Planlanan gönderi yükleme formu (hata mesajlarıyla). */
function PlannedUpload({
  onUpload,
}: {
  onUpload: (url: string, alt: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { url, alt } = await loadImageFile(file);
      onUpload(url, alt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Görsel yüklenemedi.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {busy ? "Yükleniyor…" : "Görsel yükle"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
