import { useMemo, useState } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

import { useEscapeClose, useFocusTrap } from "@/hooks/use-focus-trap";
import {
  combineDateTime,
  createChecklistItem,
  randomId,
  toDateInputValue,
  toTimeInputValue,
  toggleChecklistItem,
  validateCalendarInput,
} from "@/lib/calendar-utils";
import {
  ITEM_TYPE_META,
  STATUS_META,
  type CalendarItem,
  type CalendarItemType,
  type CalendarStatus,
  type ChecklistItem,
} from "@/lib/calendar-types";
import type { CalendarItemInput } from "@/lib/calendar-store";
import type { LinkedPostOption } from "@/lib/calendar-link";

/** İçerik türleri: Grid içeriği bağlanabilir (§13/§14). */
const LINKABLE_TYPES: CalendarItemType[] = ["post", "reel", "story"];

/**
 * Planlama formu (§11/§18/§19/§38).
 *
 * - Tür seçimi: Post / Reel / Story / Not / Görev.
 * - Post/Reel/Story: "Yeni içerik" veya
 *   "Mevcut Grid Planner içeriğini bağla" (§14).
 * - Checklist (§20), doğrulama hataları (§38),
 *   Kaydediliyor / Kaydedilemedi durumları (§36).
 */
export default function PlanningForm({
  brandId,
  projectId,
  initial,
  defaultDate,
  defaultItemType,
  linkedOptions,
  saveError,
  onSubmit,
  onClose,
}: {
  brandId: string;
  projectId: string;
  /** Düzenleme modu (tanımlıysa). */
  initial?: CalendarItem | null;
  /** Yeni kayıt için varsayılan tarih/saat. */
  defaultDate?: Date;
  /** Yeni kayıt için varsayılan içerik türü (gün detayı hızlı ekleme). */
  defaultItemType?: CalendarItemType | null;
  linkedOptions: LinkedPostOption[];
  /** Depo hatası (§36: "Kaydedilemedi" rollback sonrası). */
  saveError: string | null;
  onSubmit: (input: CalendarItemInput, id: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const editing = initial ?? null;
  const [itemType, setItemType] = useState<CalendarItemType>(
    editing?.itemType ?? defaultItemType ?? "post",
  );
  const [linkMode, setLinkMode] = useState<"new" | "existing">(
    editing?.postId ? "existing" : "new",
  );
  const [selectedPostId, setSelectedPostId] = useState<string>(
    editing?.postId ?? "",
  );
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [dateValue, setDateValue] = useState(
    editing
      ? toDateInputValue(new Date(editing.scheduledAt))
      : toDateInputValue(defaultDate ?? new Date()),
  );
  const [timeValue, setTimeValue] = useState(
    editing
      ? toTimeInputValue(new Date(editing.scheduledAt))
      : toTimeInputValue(defaultDate ?? new Date()),
  );
  const [status, setStatus] = useState<CalendarStatus>(
    editing?.status ?? "planned",
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    editing?.checklist ?? [],
  );
  const [checklistDraft, setChecklistDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeClose(true, onClose);

  const linkable = LINKABLE_TYPES.includes(itemType);
  const selectedOption = useMemo(
    () => linkedOptions.find((option) => option.postId === selectedPostId),
    [linkedOptions, selectedPostId],
  );

  function handleTypeChange(next: CalendarItemType) {
    setItemType(next);
    if (!LINKABLE_TYPES.includes(next)) {
      // Not/Görev: Grid içeriği bağlanamaz (§13).
      setLinkMode("new");
      setSelectedPostId("");
    }
  }

  function handlePostSelect(postId: string) {
    setSelectedPostId(postId);
    const option = linkedOptions.find((item) => item.postId === postId);
    // Bağlanan içeriğin başlığı otomatik dolar (§14).
    if (option && (!title.trim() || title === selectedOption?.label)) {
      setTitle(option.label);
    }
  }

  function addChecklistItem() {
    const label = checklistDraft.trim();
    if (!label) return;
    setChecklist((previous) => [...previous, createChecklistItem(label, randomId())]);
    setChecklistDraft("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const scheduledAt = combineDateTime(dateValue, timeValue);
    const input: CalendarItemInput = {
      brandId,
      projectId,
      postId: linkMode === "existing" && linkable ? selectedPostId || null : null,
      itemType,
      title,
      description,
      scheduledAt,
      status,
      checklist,
    };
    // §38: istemci tarafı doğrulama (sunucu da doğrulur).
    const validationError = validateCalendarInput(input);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const saved = await onSubmit(input, editing?.id ?? null);
      // Başarılı kayıtta form kapanır; başarısızlıkta hata
      // kullanıcıya gösterilir ve form açık kalır (§36).
      if (saved) onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-neutral-900 outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600";
  const labelClass = "mb-1 block text-xs font-medium text-neutral-600";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="planning-form-title"
    >
      <div
        className="fixed inset-0 bg-black/40 animate-dialog-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="animate-dialog-in relative my-8 w-full max-w-xl rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2
              id="planning-form-title"
              className="text-base font-semibold text-neutral-900"
            >
              {editing ? "Planlamayı düzenle" : "Yeni planlama"}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {editing
                ? "Kayıt güncellenir; değişiklikler anında kaydedilir."
                : "Bu aylık plana yeni bir içerik/not/görev eklenir."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <XMarkIcon className="size-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4"
          noValidate
        >
          {error || saveError ? (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            >
              {error ?? saveError}
            </p>
          ) : null}

          {/* İçerik türü (§18) */}
          <fieldset>
            <legend className={labelClass}>İçerik türü</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {(Object.keys(ITEM_TYPE_META) as CalendarItemType[]).map((type) => {
                const meta = ITEM_TYPE_META[type];
                const active = itemType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleTypeChange(type)}
                    className={`h-8 rounded-full px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                      active
                        ? "bg-sky-700 text-white"
                        : "border border-slate-200 bg-white text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Grid bağlantısı (§13/§14) */}
          {linkable ? (
            <fieldset>
              <legend className={labelClass}>Grid Planner içeriği</legend>
              <div
                className="mb-2 flex rounded-lg border border-slate-200 p-0.5"
                role="radiogroup"
                aria-label="İçerik kaynağı"
              >
                {(
                  [
                    { value: "new", label: "Yeni içerik" },
                    { value: "existing", label: "Mevcut içeriği bağla" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={linkMode === option.value}
                    onClick={() => setLinkMode(option.value)}
                    className={`h-7 flex-1 rounded-md text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                      linkMode === option.value
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {linkMode === "existing" ? (
                linkedOptions.length > 0 ? (
                  <select
                    value={selectedPostId}
                    onChange={(event) => handlePostSelect(event.target.value)}
                    aria-label="Bağlanacak Grid Planner içeriği"
                    className={inputClass}
                  >
                    <option value="">İçerik seçin…</option>
                    {linkedOptions.map((option) => (
                      <option key={option.postId} value={option.postId}>
                        {option.projectName} · {option.label} ({option.postType}
                        {option.hasVideo ? ", video" : ""})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-neutral-500">
                    Bu markada bağlanabilir Grid Planner içeriği yok.
                    "Yeni içerik" ile başlayın.
                  </p>
                )
              ) : null}
            </fieldset>
          ) : null}

          {/* Başlık */}
          <div>
            <label htmlFor="planning-title" className={labelClass}>
              Başlık <span className="text-red-600">*</span>
            </label>
            <input
              id="planning-title"
              type="text"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                itemType === "task"
                  ? "Örn. Reel kapak yorumlarını kontrol et"
                  : "Örn. Haftanın tasarruf önerisi"
              }
              className={inputClass}
            />
          </div>

          {/* Açıklama */}
          <div>
            <label htmlFor="planning-description" className={labelClass}>
              Açıklama
            </label>
            <textarea
              id="planning-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="İsteğe bağlı notlar, caption önerileri…"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-neutral-900 outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
            />
          </div>

          {/* Tarih + saat */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="planning-date" className={labelClass}>
                Tarih <span className="text-red-600">*</span>
              </label>
              <input
                id="planning-date"
                type="date"
                required
                value={dateValue}
                onChange={(event) => setDateValue(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="planning-time" className={labelClass}>
                Saat <span className="text-red-600">*</span>
              </label>
              <input
                id="planning-time"
                type="time"
                required
                value={timeValue}
                onChange={(event) => setTimeValue(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Durum (§8) */}
          <div>
            <label htmlFor="planning-status" className={labelClass}>
              Durum
            </label>
            <select
              id="planning-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as CalendarStatus)}
              className={inputClass}
            >
              {(Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>)
                .filter((key) => key !== "overdue")
                .map((key) => (
                  <option key={key} value={key}>
                    {STATUS_META[key].label}
                  </option>
                ))}
            </select>
          </div>

          {/* Checklist (§20) */}
          <div>
            <span className={labelClass} id="checklist-label">
              Checklist
            </span>
            <div
              role="group"
              aria-labelledby="checklist-label"
              className="rounded-lg border border-slate-200 p-2.5"
            >
              {checklist.length > 0 ? (
                <ul className="space-y-1.5">
                  {checklist.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <input
                        id={`checklist-${item.id}`}
                        type="checkbox"
                        checked={item.done}
                        onChange={() =>
                          setChecklist((previous) =>
                            toggleChecklistItem(previous, item.id),
                          )
                        }
                        className="size-4 shrink-0 accent-sky-700"
                      />
                      <label
                        htmlFor={`checklist-${item.id}`}
                        className={`min-w-0 flex-1 truncate text-sm ${
                          item.done
                            ? "text-neutral-400 line-through"
                            : "text-neutral-800"
                        }`}
                      >
                        {item.label}
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setChecklist((previous) =>
                            previous.filter((entry) => entry.id !== item.id),
                          )
                        }
                        aria-label={`Checklist öğesini kaldır: ${item.label}`}
                        className="grid size-6 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
                      >
                        <XMarkIcon className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-400">
                  Henüz checklist öğesi yok.
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={checklistDraft}
                  onChange={(event) => setChecklistDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChecklistItem();
                    }
                  }}
                  placeholder="Yeni checklist öğesi…"
                  aria-label="Yeni checklist öğesi"
                  className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-sky-600"
                />
                <button
                  type="button"
                  onClick={addChecklistItem}
                  disabled={!checklistDraft.trim()}
                  className="h-8 shrink-0 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
                >
                  Ekle
                </button>
              </div>
            </div>
          </div>

          {/* Kaydet (§36) */}
          <div className="flex items-center justify-end gap-2 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded-lg bg-sky-700 px-3.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              {submitting ? "Kaydediliyor…" : editing ? "Güncelle" : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
