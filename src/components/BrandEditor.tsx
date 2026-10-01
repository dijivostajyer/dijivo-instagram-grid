"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

import { loadImageFile } from "@/lib/validators";
import type { Brand, HashtagGroup } from "@/lib/types";

type ProfileTab = "profil" | "icerik" | "hashtagler" | "iletisim";

const profileTabs: Record<ProfileTab, { label: string; description: string }> = {
  profil: {
    label: "Profil",
    description: "Instagram'da görünen profil bilgileri.",
  },
  icerik: {
    label: "İçerik Ayarları",
    description:
      "Yeni gönderiler için varsayılan mention ve CTA şablonları; gönderi modalından tek dokunuşla eklenir.",
  },
  hashtagler: {
    label: "Hashtagler",
    description:
      "Bu markaya ait hashtag grupları; gönderi modalında başlık halinde caption'a eklenir.",
  },
  iletisim: {
    label: "İletişim",
    description: "İşletme iletişim bilgileri.",
  },
};

/** Tek satırlı etiket (chip) düzenleyici: Enter ile ekle, × ile kaldır. */
function ChipEditor({
  label,
  hint,
  values,
  placeholder,
  splitPattern,
  normalize,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  placeholder: string;
  /** Yapıştırma ayracı (virgül/boşluk) için seçenekli regex. */
  splitPattern?: string;
  /** Eklenen değeri standartlaştırmak için (örn. # öneki). */
  normalize?: (value: string) => string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const parts = splitPattern ? raw.split(new RegExp(splitPattern)) : [raw];
    const items = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (normalize ? normalize(part) : part));
    if (items.length === 0) return;
    const merged = [...values];
    for (const item of items) {
      if (!merged.includes(item)) merged.push(item);
    }
    onChange(merged);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(draft);
      setDraft("");
    } else if (
      event.key === "Backspace" &&
      draft === "" &&
      values.length > 0
    ) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-2 transition focus-within:border-sky-700 focus-within:ring-2 focus-within:ring-sky-100">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-sky-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-sky-800 ring-1 ring-sky-100"
          >
            {value}
            <button
              type="button"
              aria-label={`${value} kaldır`}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="rounded-full p-0.5 hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              <XMarkIcon className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          aria-label={label}
          placeholder={values.length === 0 ? placeholder : ""}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            commit(draft);
            setDraft("");
          }}
          className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-neutral-400"
        />
      </div>
    </div>
  );
}

/** Hashtag grubu düzenleyici (§8): başlık + etiket yönetimi + silme. */
function HashtagGroupEditor({
  group,
  onChange,
  onDelete,
  inputClass,
}: {
  group: HashtagGroup;
  onChange: (next: HashtagGroup) => void;
  onDelete: () => void;
  inputClass: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center gap-2">
        <input
          aria-label="Hashtag grubu başlığı"
          className={inputClass}
          value={group.title}
          onChange={(event) => onChange({ ...group, title: event.target.value })}
        />
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-md px-2 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          Sil
        </button>
      </div>
      <div className="mt-3">
        <ChipEditor
          label="Etiketler"
          hint="Enter ile ekle; virgülle birden fazla yapıştırın. # öneki otomatik eklenir."
          values={group.tags}
          placeholder="#ornek"
          splitPattern="[,\\s]+"
          normalize={(value) => (value.startsWith("#") ? value : `#${value}`)}
          onChange={(tags) => onChange({ ...group, tags })}
        />
      </div>
    </div>
  );
}

/**
 * Marka düzenleyicisi (§7): Instagram'da görünen "Marka Profili"
 * (Profil / İçerik Ayarları / Hashtagler / İletişim alt sekmeleri)
 * ile ajans workspace'ı için "Marka Ayarları" (istatistikler ve
 * öne çıkan yönetimi) olarak ayrılır. Değişiklikler anında üst
 * bileşenin kalıcı state'ine yansır.
 */
export default function BrandEditor({
  brand,
  onChange,
  brands,
  onCopyHighlight,
}: {
  brand: Brand;
  onChange: (next: Brand) => void;
  /** Başka markaya öne çıktı kopyalamak için marka kayıt defteri. */
  brands: Brand[];
  /** §17: öne çıkanı başka bir markaya kopyalar; hata dönerse döndürür. */
  onCopyHighlight: (highlightId: string, targetBrandId: string) => string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const highlightInputRef = useRef<HTMLInputElement>(null);
  const [highlightIdForUpload, setHighlightIdForUpload] = useState<string | null>(
    null,
  );
  const [tab, setTab] = useState<ProfileTab>("profil");
  const [highlightCopyTargets, setHighlightCopyTargets] = useState<
    Record<string, string>
  >({});
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

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

  async function handleHighlightImage(file: File | undefined) {
    if (!file || !highlightIdForUpload) return;
    setError(null);
    setBusy(true);
    try {
      const { url } = await loadImageFile(file);
      onChange({
        ...brand,
        highlights: (brand.highlights ?? []).map((highlight) =>
          highlight.id === highlightIdForUpload
            ? { ...highlight, imageUrl: url }
            : highlight,
        ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Görsel yüklenemedi.");
    } finally {
      setBusy(false);
      setHighlightIdForUpload(null);
      if (highlightInputRef.current) highlightInputRef.current.value = "";
    }
  }

  function handleCopyHighlight(highlightId: string, targetBrandId: string) {
    if (!targetBrandId) return;
    const result = onCopyHighlight(highlightId, targetBrandId);
    if (result) {
      setCopyError(result);
      setCopyNotice(null);
    } else {
      const targetName =
        brands.find((item) => item.id === targetBrandId)?.name ?? "marka";
      setCopyNotice(`Öne çıktı "${targetName}" markasına kopyalandı.`);
      setCopyError(null);
    }
    setHighlightCopyTargets((map) => ({ ...map, [highlightId]: "" }));
  }

  const otherBrands = brands.filter((item) => item.id !== brand.id);

  const labelClass = "block text-sm font-medium text-neutral-700";
  const inputClass =
    "mt-1.5 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-base text-neutral-900 outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-100 sm:text-sm";

  const hashtagGroups = brand.hashtagGroups ?? [];

  return (
    <section className="grid gap-6">
      {/* §7: Marka Profili — Instagram'da görünen alanlar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-neutral-900">
          Marka Profili
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Instagram'da görünen bilgiler.
        </p>

        <div
          className="mt-4 flex flex-wrap gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="Marka profili sekmesi"
        >
          {(Object.keys(profileTabs) as ProfileTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                tab === key
                  ? "border-sky-700 text-sky-800"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {profileTabs[key].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {profileTabs[tab].description}
        </p>

        <div className="mt-4" role="tabpanel">
          {tab === "profil" ? (
            <div className="grid gap-4">
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
                    onClick={() =>
                      onChange({ ...brand, profileImageUrl: undefined })
                    }
                    className="mt-1 rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
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
                  onChange={(event) =>
                    void handleProfileImage(event.target.files?.[0])
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="brand-name">
                  Marka adı
                </label>
                <input
                  id="brand-name"
                  name="name"
                  className={inputClass}
                  value={brand.name}
                  onChange={(event) =>
                    onChange({ ...brand, name: event.target.value })
                  }
                />
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
                  onChange={(event) =>
                    onChange({ ...brand, username: event.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="brand-display-name">
                  Gösterim adı
                </label>
                <input
                  id="brand-display-name"
                  name="displayName"
                  className={inputClass}
                  value={brand.displayName ?? ""}
                  placeholder="Instagram'da profil başlığı"
                  onChange={(event) =>
                    onChange({ ...brand, displayName: event.target.value })
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
                  rows={3}
                  className={inputClass}
                  value={brand.bio ?? ""}
                  onChange={(event) =>
                    onChange({ ...brand, bio: event.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="brand-website">
                  Web sitesi
                </label>
                <input
                  id="brand-website"
                  name="website"
                  className={inputClass}
                  value={brand.website ?? ""}
                  placeholder="https://ornek.com"
                  onChange={(event) =>
                    onChange({ ...brand, website: event.target.value })
                  }
                />
              </div>
            </div>
          ) : null}

          {tab === "icerik" ? (
            <div className="grid gap-5">
              <ChipEditor
                label="Varsayılan mention'lar"
                hint="@kullanici biçiminde; gönderi modalından tek dokunuşla caption'a eklenir."
                values={brand.defaultMentions ?? []}
                placeholder="@kullanici"
                normalize={(value) =>
                  value.startsWith("@") ? value : `@${value}`
                }
                onChange={(defaultMentions) =>
                  onChange({ ...brand, defaultMentions })
                }
              />
              <ChipEditor
                label="Varsayılan CTA'lar"
                hint="Çağrı-cevap şablonları; gönderi modalından tek dokunuşla caption'a eklenir."
                values={brand.defaultCtas ?? []}
                placeholder="Linke tıklayın"
                onChange={(defaultCtas) => onChange({ ...brand, defaultCtas })}
              />
            </div>
          ) : null}

          {tab === "hashtagler" ? (
            <div className="grid gap-3">
              {hashtagGroups.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-neutral-500">
                  Henüz hashtag grubu yok. İlk grubu oluşturun.
                </p>
              ) : (
                hashtagGroups.map((group) => (
                  <HashtagGroupEditor
                    key={group.id}
                    group={group}
                    inputClass={inputClass}
                    onChange={(next) =>
                      onChange({
                        ...brand,
                        hashtagGroups: hashtagGroups.map((item) =>
                          item.id === group.id ? next : item,
                        ),
                      })
                    }
                    onDelete={() =>
                      onChange({
                        ...brand,
                        hashtagGroups: hashtagGroups.filter(
                          (item) => item.id !== group.id,
                        ),
                      })
                    }
                  />
                ))
              )}
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...brand,
                    hashtagGroups: [
                      ...hashtagGroups,
                      {
                        id: `hashtag-group-${Date.now()}`,
                        title: "Yeni grup",
                        tags: [],
                      },
                    ],
                  })
                }
                className="w-fit rounded-md border border-black/10 px-2 py-1 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                Hashtag grubu ekle
              </button>
            </div>
          ) : null}

          {tab === "iletisim" ? (
            <div className="grid gap-4">
              <div>
                <label className={labelClass} htmlFor="brand-phone">
                  Telefon
                </label>
                <input
                  id="brand-phone"
                  name="phone"
                  type="tel"
                  className={inputClass}
                  value={brand.phone ?? ""}
                  placeholder="+90 500 000 00 00"
                  onChange={(event) =>
                    onChange({ ...brand, phone: event.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="brand-email">
                  E-posta
                </label>
                <input
                  id="brand-email"
                  name="email"
                  type="email"
                  className={inputClass}
                  value={brand.email ?? ""}
                  placeholder="iletisim@ornek.com"
                  onChange={(event) =>
                    onChange({ ...brand, email: event.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="brand-contact-website">
                  Web sitesi
                </label>
                <input
                  id="brand-contact-website"
                  name="website"
                  className={inputClass}
                  value={brand.website ?? ""}
                  placeholder="https://ornek.com"
                  onChange={(event) =>
                    onChange({ ...brand, website: event.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="brand-category">
                  Kategori
                </label>
                <input
                  id="brand-category"
                  name="category"
                  className={inputClass}
                  value={brand.category ?? ""}
                  placeholder="Dijital ajans"
                  onChange={(event) =>
                    onChange({ ...brand, category: event.target.value })
                  }
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* §7: Marka Ayarları — ajans çalışma alanı */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-neutral-900">
          Marka Ayarları
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Ajans workspace'ı: profil istatistikleri ve öne çıkan yönetimi.
        </p>

        <div className="mt-4 grid gap-4">
          <div className="grid grid-cols-3 gap-2">
            {([
              ["postCount", "Gönderi"],
              ["followersCount", "Takipçi"],
              ["followingCount", "Takip"],
            ] as const).map(([field, label]) => (
              <label key={field} className={labelClass}>
                {label}
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={brand[field] ?? 0}
                  onChange={(event) =>
                    onChange({
                      ...brand,
                      [field]: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                />
              </label>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className={labelClass}>Öne çıkanlar</p>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-black/5">
                {(brand.highlights ?? []).length} öne çıkan
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Kapak önizlemesi, başlık ve görsel kontrolleri: kapağı değiştir,
              kaldır, sil veya başka bir markaya kopyala.
            </p>
            <div className="mt-3 grid gap-2">
              {(brand.highlights ?? []).map((highlight) => (
                <div className="flex flex-wrap items-center gap-2" key={highlight.id}>
                  <button
                    type="button"
                    aria-label={`${highlight.title} kapak görselini değiştir`}
                    onClick={() => {
                      setHighlightIdForUpload(highlight.id);
                      highlightInputRef.current?.click();
                    }}
                    className="shrink-0 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-600"
                  >
                    {highlight.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={highlight.imageUrl}
                        alt=""
                        className="size-11 rounded-full object-cover ring-1 ring-black/10"
                      />
                    ) : (
                      <span className="block size-11 rounded-full bg-neutral-100 ring-1 ring-black/10" />
                    )}
                  </button>
                  <input
                    aria-label="Öne çıkan başlığı"
                    className={inputClass}
                    value={highlight.title}
                    onChange={(event) =>
                      onChange({
                        ...brand,
                        highlights: (brand.highlights ?? []).map((item) =>
                          item.id === highlight.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  {otherBrands.length > 0 ? (
                    <select
                      aria-label={`${highlight.title} öne çıkanı başka markaya kopyala`}
                      value={highlightCopyTargets[highlight.id] ?? ""}
                      onChange={(event) => {
                        setHighlightCopyTargets((map) => ({
                          ...map,
                          [highlight.id]: event.target.value,
                        }));
                        if (event.target.value) {
                          handleCopyHighlight(highlight.id, event.target.value);
                        }
                      }}
                      className="shrink-0 rounded-lg border border-black/10 bg-white px-2 py-2 text-sm text-neutral-700 outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">Başka markaya kopyala…</option>
                      {otherBrands.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="shrink-0 text-xs text-neutral-400">
                      Kopya hedefi için bir sonraki markayı oluşturun
                    </span>
                  )}
                  {highlight.imageUrl ? (
                    <button
                      type="button"
                      aria-label={`${highlight.title} kapak görselini kaldır`}
                      className="shrink-0 rounded-md px-2 text-sm text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                      onClick={() =>
                        onChange({
                          ...brand,
                          highlights: (brand.highlights ?? []).map((item) =>
                            item.id === highlight.id
                              ? { ...item, imageUrl: undefined }
                              : item,
                          ),
                        })
                      }
                    >
                      Kapağı kaldır
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                    onClick={() =>
                      onChange({
                        ...brand,
                        highlights: (brand.highlights ?? []).filter(
                          (item) => item.id !== highlight.id,
                        ),
                      })
                    }
                  >
                    Sil
                  </button>
                </div>
              ))}
              <input
                ref={highlightInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) =>
                  void handleHighlightImage(event.target.files?.[0])
                }
              />
              <button
                type="button"
                className="w-fit rounded-md border border-black/10 px-2 py-1 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                onClick={() =>
                  onChange({
                    ...brand,
                    highlights: [
                      ...(brand.highlights ?? []),
                      { id: `highlight-${Date.now()}`, title: "Yeni öne çıkan" },
                    ],
                  })
                }
              >
                Öne çıkan ekle
              </button>
            </div>
          </div>
        </div>
      </div>

      {busy ? (
        <p className="text-sm text-neutral-500">Görsel yükleniyor…</p>
      ) : null}
      {copyNotice ? (
        <p className="text-sm font-medium text-emerald-700">{copyNotice}</p>
      ) : null}
      {copyError ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {copyError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
