"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

import { type PostCopyOptions } from "@/hooks/use-persisted-grid";
import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";

/**
 * Toplu gönderi kopyalama diyalogu (§18): medya panelindeki
 * çoklu seçimden seçilen gönderileri başka bir aylık plana
 * (aynı veya başka marka) kopyalar. Seçenekler tekil kopyayla
 * aynıdır; kaynağı değiştirmeden yeni kimliklerle yazılır.
 */
export default function BulkCopyDialog({
  count,
  allProjects,
  brands,
  onClose,
  onSubmit,
}: {
  /** Kopyalanacak seçili gönderi sayısı. */
  count: number;
  /** Kopya hedefi seçici için tüm projeler (tüm markalar). */
  allProjects: GridProject[];
  /** Hedef marka adları için marka kayıt defteri. */
  brands: Brand[];
  onClose: () => void;
  /** Kopya işlemini yürütür; özet mesajı döndürür. */
  onSubmit: (targetProjectId: string, options: PostCopyOptions) => string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState("");
  const [options, setOptions] = useState<PostCopyOptions>({
    caption: true,
    postType: true,
    hashtags: true,
    pinned: false,
  });
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  /** Kayıt dışı projeler (eski veri) belirsiz bir etiketle gösterme. */
  const brandForProject = (project: GridProject) =>
    brands.find((item) => item.id === project.brandId)?.name ??
    "Kayıtsız marka";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setResult(onSubmit(target, options));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${count} gönderiyi kopyala`}
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative my-6 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-neutral-900">
            {count} gönderiyi kopyala
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <XMarkIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        {result ? (
          <div className="p-5">
            <p className="text-sm text-neutral-700">{result}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 inline-flex h-9 items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Tamam
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5">
            <label className="block text-sm font-medium text-neutral-700" htmlFor="bulk-copy-target">
              Hedef aylık plan
            </label>
            <select
              id="bulk-copy-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="mt-1.5 h-9 w-full rounded-lg border border-black/10 bg-white px-2.5 text-sm outline-none focus:border-sky-700"
              required
            >
              <option value="">Hedef projeyi seçin…</option>
              {allProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {brandForProject(project)} › {project.name} (
                  {project.month}/{project.year})
                </option>
              ))}
            </select>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-neutral-700">
                Kopyalanacak alanlar
              </legend>
              <div className="mt-2 grid gap-1.5">
                {(
                  [
                    ["caption", "Caption"],
                    ["postType", "İçerik türü"],
                    ["hashtags", "Hedef markanın hashtag grupları"],
                    ["pinned", "Pin durumu"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm text-neutral-700"
                  >
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(event) =>
                        setOptions((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                      className="size-4 accent-sky-700"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                Pin durumu varsayılan olarak kopyalanmaz; hedefteki
                sabitleme sınırı (3) korunur.
              </p>
            </fieldset>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={!target}
                className="inline-flex h-9 items-center rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                {count} gönderiyi kopyala
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
