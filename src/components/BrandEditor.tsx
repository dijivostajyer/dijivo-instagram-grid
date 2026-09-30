"use client";

import { useRef, useState } from "react";

import { loadImageFile } from "@/lib/validators";
import type { Brand } from "@/lib/types";

/**
 * Marka bilgileri düzenleyicisi: ad, kullanıcı adı, açıklama ve profil görseli.
 * Değişiklikler anında üst bileşenin kalıcı state'ine yansır.
 */
export default function BrandEditor({
  brand,
  onChange,
}: {
  brand: Brand;
  onChange: (next: Brand) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleProfileImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { url } = await loadImageFile(file);
      onChange({ ...brand, profileImageUrl: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Görsel yüklenemedi.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const labelClass = "block text-sm font-medium text-neutral-700";
  const inputClass =
    "mt-1.5 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-base text-neutral-900 outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-100 sm:text-sm";

  return (
    <section>
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-600"
          aria-label="Profil görselini değiştir"
        >
          {brand.profileImageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={brand.profileImageUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-black/20 text-xl text-neutral-400">
              +
            </span>
          )}
        </button>
        {brand.profileImageUrl ? (
          <button
            type="button"
            onClick={() => onChange({ ...brand, profileImageUrl: undefined })}
            className="mt-1 rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Profil görselini kaldır
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          name="profile-image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleProfileImage(e.target.files?.[0])}
        />
        <div className="grid flex-1 gap-4">
          <div>
            <label className={labelClass} htmlFor="brand-name">
              Marka adı
            </label>
            <input
              id="brand-name"
              name="name"
              className={inputClass}
              value={brand.name}
              onChange={(e) => onChange({ ...brand, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["postCount", "Gönderi"],
              ["followersCount", "Takipçi"],
              ["followingCount", "Takip"],
            ] as const).map(([field, label]) => (
              <label key={field} className={labelClass}>{label}
                <input type="number" min="0" className={inputClass} value={brand[field] ?? 0} onChange={(event) => onChange({ ...brand, [field]: Math.max(0, Number(event.target.value) || 0) })} />
              </label>
            ))}
          </div>
          <div>
            <p className={labelClass}>Öne çıkanlar</p>
            <div className="mt-2 grid gap-2">
              {(brand.highlights ?? []).map((highlight) => (
                <div className="flex gap-2" key={highlight.id}>
                  <input aria-label="Öne çıkan başlığı" className={inputClass} value={highlight.title} onChange={(event) => onChange({ ...brand, highlights: (brand.highlights ?? []).map((item) => item.id === highlight.id ? { ...item, title: event.target.value } : item) })} />
                  <button type="button" className="rounded-md px-2 text-sm text-red-700 hover:bg-red-50" onClick={() => onChange({ ...brand, highlights: (brand.highlights ?? []).filter((item) => item.id !== highlight.id) })}>Sil</button>
                </div>
              ))}
              <button type="button" className="w-fit rounded-md border border-black/10 px-2 py-1 text-sm font-medium hover:bg-neutral-50" onClick={() => onChange({ ...brand, highlights: [...(brand.highlights ?? []), { id: `highlight-${Date.now()}`, title: "Yeni öne çıkan" }] })}>Öne çıkan ekle</button>
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="brand-username">
              Kullanıcı adı
            </label>
            <input
              id="brand-username"
              name="username"
              className={inputClass}
              value={brand.username}
              onChange={(e) =>
                onChange({ ...brand, username: e.target.value })
              }
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="brand-bio">
              Kısa açıklama
            </label>
            <textarea
              id="brand-bio"
              name="bio"
              rows={2}
              className={inputClass}
              value={brand.bio ?? ""}
              onChange={(e) => onChange({ ...brand, bio: e.target.value })}
            />
          </div>
        </div>
      </div>
      {busy ? (
        <p className="mt-3 text-sm text-neutral-500">Görsel yükleniyor…</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
