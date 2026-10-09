"use client";

import { useRef, useState, type FormEvent } from "react";
import { ChevronDownIcon, PhotoIcon } from "@heroicons/react/16/solid";

import type { NewBrandInput } from "@/hooks/use-persisted-grid";
import { loadImageFile } from "@/lib/validators";
import { withBasePath } from "@/lib/base-path";
import type { InstagramProfile } from "@/lib/instagram/types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const inputClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-neutral-900 outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600";

const labelClass = "mb-1 block text-xs font-medium text-neutral-600";

/**
 * Marka oluşturma formu (onboarding ekranı ve '+ Yeni Marka'
 * diyalogu için ortak). Marka adı ve Instagram kullanıcı adı
 * zorunludur; geri kalan alanlar isteğe bağlıdır (§2).
 */
export default function BrandForm({
  submitLabel = "Marka oluştur",
  onSubmit,
}: {
  submitLabel?: string;
  onSubmit: (input: NewBrandInput) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [postCount, setPostCount] = useState("");
  const [followersCount, setFollowersCount] = useState("");
  const [followingCount, setFollowingCount] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState<string | undefined>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Instagram import state
  const [instagramUrl, setInstagramUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [importedProfile, setImportedProfile] = useState<InstagramProfile | null>(null);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<Set<string>>(new Set());

  const valid = name.trim().length > 0 && username.trim().length > 0;

  async function handlePhoto(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    try {
      const { url } = await loadImageFile(files[0]);
      setProfileImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Profil görseli yüklenemedi.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleInstagramImport() {
    setError(null);
    setImportWarning(null);
    setIsImporting(true);

    try {
      const session = (await getSupabaseBrowserClient()?.auth.getSession())?.data.session;
      if (!session) {
        setImportWarning("Instagram bilgilerini almak için giriş yapın.");
        return;
      }
      const response = await fetch(withBasePath("/api/instagram/profile-import"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: instagramUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        setImportWarning(data.error || "Instagram bilgileri alınamadı.");
        return;
      }

      if (data.ok && data.profile) {
        const profile = data.profile as InstagramProfile;
        setImportedProfile(profile);
        setSelectedPostIds(new Set((profile.recentPosts ?? []).map((post) => post.id)));
        setSelectedHighlightIds(new Set((profile.highlights ?? []).map((highlight) => highlight.id)));
        setUsername(profile.username);
        setName((current) => current.trim() || profile.displayName || profile.username);
        if (profile.displayName) setDisplayName(profile.displayName);
        if (profile.biography) setBio(profile.biography);
        if (profile.profileImageUrl) setProfileImageUrl(profile.profileImageUrl);
        if (profile.followersCount !== undefined) setFollowersCount(profile.followersCount.toString());
        if (profile.followingCount !== undefined) setFollowingCount(profile.followingCount.toString());
        if (profile.postsCount !== undefined) setPostCount(profile.postsCount.toString());
        setShowAdvanced(true);

        if (data.warnings && data.warnings.length > 0) {
          setImportWarning(data.warnings.join(" "));
        }
      }
    } catch (e) {
      setImportWarning("Instagram bilgileri alınamadı.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const numberOrUndefined = (value: string): number | undefined => {
      const parsed = Number(value);
      return value.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
    };
    onSubmit({
      name,
      username,
      displayName: displayName.trim() || undefined,
      profileImageUrl,
      bio: bio.trim() || undefined,
      website: website.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      category: category.trim() || undefined,
      postCount: numberOrUndefined(postCount),
      followersCount: numberOrUndefined(followersCount),
      followingCount: numberOrUndefined(followingCount),
      importedPosts: (importedProfile?.recentPosts ?? []).filter((post) => selectedPostIds.has(post.id) && Boolean(post.thumbnailUrl)).map((post) => ({
        id: post.id,
        thumbnailUrl: post.thumbnailUrl!,
        mediaUrl: post.mediaUrl,
        caption: post.caption,
        type: post.type,
      })),
      importedHighlights: (importedProfile?.highlights ?? []).filter((highlight) => selectedHighlightIds.has(highlight.id)).map((highlight) => ({
        id: highlight.id,
        title: highlight.title,
        coverUrl: highlight.coverUrl,
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="brand-name" className={labelClass}>
          Marka adı <span className="text-red-600">*</span>
        </label>
        <input
          id="brand-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="örn. Dijivo"
          required
          className={inputClass}
        />
      </div>

      {/* Instagram Import */}
      <div>
        <label htmlFor="instagram-url" className={labelClass}>
          Instagram Profil Linki
        </label>
        <div className="flex gap-2">
          <input
            id="instagram-url"
            value={instagramUrl}
            onChange={(event) => setInstagramUrl(event.target.value)}
            placeholder="https://instagram.com/kullaniciadi"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void handleInstagramImport()}
            disabled={isImporting || !instagramUrl.trim()}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            {isImporting ? "Instagram bilgileri alınıyor..." : "Instagram’dan Bilgileri Getir"}
          </button>
        </div>
        {importWarning && (
          <p className="mt-1 text-xs text-amber-700">{importWarning}</p>
        )}
      </div>

      {importedProfile ? (
        <section aria-label="Instagram içe aktarma önizlemesi" className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <div className="flex items-start gap-3">
            {importedProfile.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={importedProfile.profileImageUrl} alt="Instagram profil görseli" className="size-12 shrink-0 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10" />
            ) : null}
            <div className="min-w-0">
              <p className="font-semibold text-neutral-900">{importedProfile.displayName ?? importedProfile.username}</p>
              <p className="text-sm text-neutral-600">@{importedProfile.username}</p>
              {importedProfile.biography ? <p className="mt-1 text-sm text-neutral-700">{importedProfile.biography}</p> : null}
              <p className="mt-2 text-xs text-neutral-600">
                {importedProfile.followersCount !== undefined ? `${importedProfile.followersCount.toLocaleString("tr-TR")} takipçi` : "Takipçi bilgisi yok"}
                {importedProfile.postsCount !== undefined ? ` · ${importedProfile.postsCount.toLocaleString("tr-TR")} gönderi` : ""}
              </p>
              {importedProfile.isPrivate ? <p className="mt-2 text-xs font-medium text-amber-800">Bu profil gizli; yalnız erişilebilen bilgiler içe aktarıldı.</p> : null}
            </div>
          </div>

          {(importedProfile.recentPosts?.length ?? 0) > 0 ? (
            <fieldset className="mt-4 border-t border-sky-200 pt-3">
              <legend className="text-sm font-medium text-neutral-800">İçe aktarılacak son gönderiler</legend>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {importedProfile.recentPosts?.map((post) => (
                  <label key={post.id} className="relative block cursor-pointer overflow-hidden rounded-lg bg-white outline-1 -outline-offset-1 outline-black/10">
                    <input
                      name={`instagram-post-${post.id}`}
                      type="checkbox"
                      checked={selectedPostIds.has(post.id)}
                      onChange={(event) => setSelectedPostIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(post.id); else next.delete(post.id);
                        return next;
                      })}
                      className="absolute left-2 top-2 size-5 appearance-auto accent-sky-700"
                      aria-label={`${post.id} gönderisini içe aktar`}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.thumbnailUrl ?? ""} alt="" className="aspect-square w-full object-cover" />
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {(importedProfile.highlights?.length ?? 0) > 0 ? (
            <fieldset className="mt-4 border-t border-sky-200 pt-3">
              <legend className="text-sm font-medium text-neutral-800">İçe aktarılacak öne çıkanlar</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {importedProfile.highlights?.map((highlight) => (
                  <label key={highlight.id} className="flex h-9 items-center gap-2 rounded-lg bg-white px-2 text-sm text-neutral-700 outline-1 -outline-offset-1 outline-black/10">
                    <input
                      name={`instagram-highlight-${highlight.id}`}
                      type="checkbox"
                      checked={selectedHighlightIds.has(highlight.id)}
                      onChange={(event) => setSelectedHighlightIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(highlight.id); else next.delete(highlight.id);
                        return next;
                      })}
                      className="size-5 appearance-auto accent-sky-700"
                    />
                    {highlight.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={highlight.coverUrl} alt="" className="size-5 rounded-full object-cover" />
                    ) : null}
                    <span>{highlight.title}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </section>
      ) : null}

      <div>
        <label htmlFor="brand-username" className={labelClass}>
          Instagram kullanıcı adı <span className="text-red-600">*</span>
        </label>
        <input
          id="brand-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="örn. dijivo"
          required
          className={inputClass}
        />
      </div>

      <div>
        <span className={labelClass}>Profil görseli</span>
        <div className="flex items-center gap-3">
          {profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profileImageUrl}
              alt="Profil görseli önizleme"
              className="size-14 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10"
            />
          ) : (
            <span className="grid size-14 place-items-center rounded-full bg-neutral-100 text-neutral-400">
              <PhotoIcon className="size-6" aria-hidden="true" />
            </span>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Görsel yükle
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => void handlePhoto(event.target.files)}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((value) => !value)}
        aria-expanded={showAdvanced}
        className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        <ChevronDownIcon
          className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        Gelişmiş alanlar (isteğe bağlı)
      </button>

      {showAdvanced ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-neutral-50 p-4">
          <div>
            <label htmlFor="brand-display-name" className={labelClass}>
              Görünen ad
            </label>
            <input
              id="brand-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Instagram'da görüntülenen ad"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="brand-bio" className={labelClass}>
              Bio
            </label>
            <textarea
              id="brand-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={2}
              placeholder="Kısa profil açıklaması"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-neutral-900 outline-none focus:border-sky-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="brand-website" className={labelClass}>
                Web sitesi
              </label>
              <input
                id="brand-website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="brand-category" className={labelClass}>
                Kategori
              </label>
              <input
                id="brand-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="örn. Dijital Ajans"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="brand-phone" className={labelClass}>
                Telefon
              </label>
              <input
                id="brand-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+90"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="brand-email" className={labelClass}>
                E-posta
              </label>
              <input
                id="brand-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@domain.com"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="brand-post-count" className={labelClass}>
                Gönderi sayısı
              </label>
              <input
                id="brand-post-count"
                type="number"
                min={0}
                value={postCount}
                onChange={(event) => setPostCount(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="brand-followers" className={labelClass}>
                Takipçi sayısı
              </label>
              <input
                id="brand-followers"
                type="number"
                min={0}
                value={followersCount}
                onChange={(event) => setFollowersCount(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="brand-following" className={labelClass}>
                Takip edilen
              </label>
              <input
                id="brand-following"
                type="number"
                min={0}
                value={followingCount}
                onChange={(event) => setFollowingCount(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!valid}
        className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        {importedProfile ? "Bu Bilgilerle Markayı Oluştur" : submitLabel}
      </button>
      <p className="text-center text-xs text-neutral-500">
        * Marka adı ve kullanıcı adı zorunludur; diğer alanları sonradan
        düzenleyebilirsiniz.
      </p>
    </form>
  );
}
