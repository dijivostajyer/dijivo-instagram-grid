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

  const labelClass = "block text-xs font-medium text-neutral-700";
  const inputClass =
    "mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none";

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-3 text-sm font-semibold">Marka Bilgileri</h2>
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded-full outline-offset-2 focus:outline-neutral-900"
          aria-label="Profil görselini değiştir"
        >
          {brand.profileImageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={brand.profileImageUrl}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-neutral-400 text-xl text-neutral-400">
              +
            </span>
          )}
        </button>
        {brand.profileImageUrl ? (
          <button
            type="button"
            onClick={() => onChange({ ...brand, profileImageUrl: undefined })}
            className="mt-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Profil görselini kaldır
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleProfileImage(e.target.files?.[0])}
        />
        <div className="grid flex-1 gap-2">
          <div>
            <label className={labelClass} htmlFor="brand-name">
              Marka adı
            </label>
            <input
              id="brand-name"
              className={inputClass}
              value={brand.name}
              onChange={(e) => onChange({ ...brand, name: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="brand-username">
              Kullanıcı adı
            </label>
            <input
              id="brand-username"
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
              rows={2}
              className={inputClass}
              value={brand.bio ?? ""}
              onChange={(e) => onChange({ ...brand, bio: e.target.value })}
            />
          </div>
        </div>
      </div>
      {busy ? (
        <p className="mt-2 text-xs text-neutral-500">Görsel yükleniyor…</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
