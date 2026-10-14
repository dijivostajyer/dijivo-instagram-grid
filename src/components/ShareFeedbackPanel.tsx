"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircleIcon, PencilSquareIcon } from "@heroicons/react/16/solid";

import {
  FEEDBACK_ACTION_LABELS,
  MAX_CLIENT_NAME_LENGTH,
  MAX_FEEDBACK_MESSAGE_LENGTH,
  formatFeedbackTime,
  type FeedbackAction,
  type PublicFeedbackRecord,
} from "@/lib/share-feedback";

type Mode = "idle" | "approve" | "revise";

/**
 * Paylaşım ekranında tek bir hedef (Post, Reel, Story veya tüm grid) için
 * Onayladım / Revize İste paneli. Son durumu gösterir; her gönderim yeni
 * bir kayıt oluşturur (geçmiş silinmez).
 */
export default function ShareFeedbackPanel({
  latest,
  approveLabel = "Onayladım",
  reviseLabel = "Revize İste",
  approveQuestion = "Bu içeriği onaylıyor musunuz?",
  approvedMessage = "İçerik onaylandı.",
  clientName,
  onClientNameChange,
  onSubmit,
  onActiveChange,
  tone = "light",
}: {
  latest?: PublicFeedbackRecord;
  approveLabel?: string;
  reviseLabel?: string;
  approveQuestion?: string;
  approvedMessage?: string;
  /** Müşteri beyanı; kimlik doğrulaması değildir. */
  clientName: string;
  onClientNameChange: (name: string) => void;
  /** `clientName`: bu gönderimde kullanılan ad (yeni yazılmış olabilir). */
  onSubmit: (action: FeedbackAction, message: string | null, clientName: string) => Promise<void>;
  /** Form açıkken true (ör. Story otomatik ilerlemesini durdurmak için). */
  onActiveChange?: (active: boolean) => void;
  tone?: "light" | "dark";
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [message, setMessage] = useState("");
  const [name, setName] = useState(clientName);
  const [editingName, setEditingName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const ids = { name: useId(), message: useId() };
  const dark = tone === "dark";

  // Callback kimliği her render'da değişebilir; en güncelini ref'te tut ki
  // yalnız form açılıp kapandığında (ve unmount'ta) bildirilsin.
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);
  useEffect(() => setName(clientName), [clientName]);
  useEffect(() => {
    onActiveChangeRef.current?.(mode !== "idle");
  }, [mode]);
  useEffect(() => () => onActiveChangeRef.current?.(false), []);

  const needsName = !clientName || editingName;
  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= MAX_CLIENT_NAME_LENGTH;
  const messageValid = mode !== "revise" || (message.trim().length > 0 && message.length <= MAX_FEEDBACK_MESSAGE_LENGTH);

  function open(next: Mode) {
    setMode(next);
    setError(null);
    setSuccess(null);
  }

  function cancel() {
    setMode("idle");
    setMessage("");
    setError(null);
  }

  async function submit() {
    if (needsName && !nameValid) {
      setError("Lütfen adınızı yazın.");
      return;
    }
    if (!messageValid) {
      setError("Lütfen revize talebinizi yazın.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const effectiveName = needsName ? trimmedName : clientName;
      const action: FeedbackAction = mode === "revise" ? "revision_requested" : "approved";
      await onSubmit(action, action === "revision_requested" ? message.trim() : null, effectiveName);
      if (needsName) {
        onClientNameChange(trimmedName);
        setEditingName(false);
      }
      setSuccess(action === "approved" ? approvedMessage : "Revize talebiniz kaydedildi.");
      setMode("idle");
      setMessage("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Geri bildirim kaydedilemedi. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  const muted = dark ? "text-white/70" : "text-neutral-500";
  const fieldClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-sky-600 focus-visible:ring-2 focus-visible:ring-sky-600/30 ${dark ? "border-white/20 bg-black/40 text-white placeholder:text-white/50" : "border-slate-200 bg-white text-neutral-900 placeholder:text-neutral-400"}`;
  const secondaryButton = `inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50 ${dark ? "text-white/80 hover:bg-white/10" : "text-neutral-600 hover:bg-neutral-100"}`;

  return (
    <section aria-label="Geri bildirim" className="flex flex-col gap-3">
      {latest ? (
        <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${muted}`} data-testid="feedback-latest">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
              latest.action === "approved"
                ? dark ? "bg-emerald-500/20 text-emerald-200" : "bg-emerald-50 text-emerald-800"
                : dark ? "bg-amber-500/20 text-amber-200" : "bg-amber-50 text-amber-800"
            }`}
          >
            Son durum: {FEEDBACK_ACTION_LABELS[latest.action]}
          </span>
          <time dateTime={latest.createdAt} suppressHydrationWarning>{formatFeedbackTime(latest.createdAt)}</time>
          <span>· {latest.clientName}</span>
        </p>
      ) : null}
      {latest?.action === "revision_requested" && latest.message ? (
        <p className={`line-clamp-3 whitespace-pre-line rounded-lg px-3 py-2 text-xs ${dark ? "bg-white/10 text-white/85" : "bg-amber-50/60 text-neutral-700"}`}>
          {latest.message}
        </p>
      ) : null}

      {mode === "idle" ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => open("approve")}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <CheckCircleIcon className="size-4" aria-hidden="true" />
            {approveLabel}
          </button>
          <button
            type="button"
            onClick={() => open("revise")}
            className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${dark ? "border-amber-300/50 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25" : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}
          >
            <PencilSquareIcon className="size-4" aria-hidden="true" />
            {reviseLabel}
          </button>
        </div>
      ) : (
        <div className={`flex flex-col gap-3 rounded-xl border p-3 ${dark ? "border-white/15 bg-black/50" : "border-slate-200 bg-slate-50/80"}`}>
          {mode === "approve" ? <p className={`text-sm font-medium ${dark ? "text-white" : "text-neutral-900"}`}>{approveQuestion}</p> : null}
          {mode === "revise" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.message} className={`text-sm font-medium ${dark ? "text-white" : "text-neutral-900"}`}>Revize talebi</label>
              <textarea
                id={ids.message}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
                rows={4}
                autoFocus
                placeholder="Revize talebinizi yazın..."
                className={`${fieldClass} min-h-24 resize-y`}
              />
              <span className={`self-end text-xs tabular-nums ${muted}`}>{message.length} / {MAX_FEEDBACK_MESSAGE_LENGTH}</span>
            </div>
          ) : null}
          {needsName ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.name} className={`text-sm font-medium ${dark ? "text-white" : "text-neutral-900"}`}>Adınız / Marka Yetkilisi</label>
              <input
                id={ids.name}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_CLIENT_NAME_LENGTH}
                autoComplete="name"
                placeholder="Örn. Ayşe Yılmaz"
                className={fieldClass}
              />
            </div>
          ) : (
            <p className={`text-xs ${muted}`}>
              <span className="font-medium">{clientName}</span> olarak gönderilecek ·{" "}
              <button type="button" onClick={() => setEditingName(true)} className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-800">Değiştir</button>
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={cancel} disabled={busy} className={secondaryButton}>Vazgeç</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className={`inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700 focus-visible:outline-emerald-600" : "bg-amber-600 hover:bg-amber-700 focus-visible:outline-amber-600"}`}
            >
              {busy ? "Gönderiliyor..." : mode === "approve" ? "Evet, Onayla" : "Revize Talebini Gönder"}
            </button>
          </div>
        </div>
      )}

      {error ? <p role="alert" className={`text-sm ${dark ? "text-red-300" : "text-red-700"}`}>{error}</p> : null}
      {success ? <p role="status" className={`text-sm font-medium ${dark ? "text-emerald-200" : "text-emerald-700"}`}>{success}</p> : null}
    </section>
  );
}
