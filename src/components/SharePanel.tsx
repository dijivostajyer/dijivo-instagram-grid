"use client";

import { useCallback, useState } from "react";
import { ClipboardDocumentIcon, ShareIcon } from "@heroicons/react/16/solid";

import { prepareShareInput } from "@/lib/share-client";
import type { Brand, GridResult } from "@/lib/types";

/**
 * Paylaşım bağlantı durumu + aksiyonları. GridManager'da tek örnek olarak
 * tutulur; böylece Paylaşım ekranından çıkınca da bağlantı kaybolmaz.
 */
export interface ShareController {
  link: string | null;
  token: string | null;
  message: string | null;
  busy: boolean;
  createLink: () => Promise<void>;
  revokeLink: () => Promise<void>;
  copyLink: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenResponse(value: unknown): value is { token: string } {
  return isRecord(value) && typeof value.token === "string";
}

function isErrorResponse(value: unknown): value is { error: string } {
  return isRecord(value) && typeof value.error === "string";
}

/**
 * Oluştur / kopyala / iptal akışını yönetir. API davranışı değişmedi:
 * POST /api/shares, DELETE /api/shares/[token].
 */
export function useShareController(brand: Brand, result: GridResult): ShareController {
  const [link, setLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createLink = useCallback(async () => {
    if (result.cells.length === 0) {
      setMessage("Grid boşken paylaşım bağlantısı oluşturulamaz.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const input = await prepareShareInput(brand, result);
      const response = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isTokenResponse(body)) {
        throw new Error(
          isErrorResponse(body) ? body.error : "Paylaşım bağlantısı oluşturulamadı.",
        );
      }
      setLink(`${window.location.origin}/share/${body.token}`);
      setToken(body.token);
      setMessage("Salt-okunur paylaşım bağlantısı hazır.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Paylaşım bağlantısı oluşturulamadı.",
      );
    } finally {
      setBusy(false);
    }
  }, [brand, result]);

  const revokeLink = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/shares/${token}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Paylaşım bağlantısı kaldırılamadı.");
      setLink(null);
      setToken(null);
      setMessage("Paylaşım bağlantısı kaldırıldı.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Paylaşım bağlantısı kaldırılamadı.",
      );
    } finally {
      setBusy(false);
    }
  }, [token]);

  const copyLink = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Bağlantı panoya kopyalandı.");
    } catch (error) {
      console.warn("[share] Clipboard yazılamadı:", error);
      setMessage("Bağlantı kopyalanamadı; aşağıdaki bağlantıyı manuel kopyalayın.");
    }
  }, [link]);

  return { link, token, message, busy, createLink, revokeLink, copyLink };
}

/**
 * Salt-okunur paylaşım arayüzü: oluştur, kopyala, yeni sekmede aç, iptal et.
 * Revokesuz auth modeli korunmuştur (capability-token).
 */
export default function SharePanel({
  result,
  controller,
}: {
  result: GridResult;
  controller: ShareController;
}) {
  const { link, message, busy, createLink, revokeLink, copyLink } = controller;
  const disabled = busy || result.cells.length === 0;

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-900">Salt-okunur paylaşım</h2>
      <p className="mb-4 mt-1 text-sm text-neutral-500">
        Bu anki gridin sabit bir kopyasını oluşturur. Sonraki düzenlemeler bu
        bağlantıdaki görünümü değiştirmez.
      </p>
      <button
        type="button"
        onClick={() => void createLink()}
        disabled={disabled}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ShareIcon className="size-4" aria-hidden="true" />
        {busy ? "Bağlantı hazırlanıyor…" : "Paylaşım Linki Oluştur"}
      </button>
      {result.cells.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          Grid boş: paylaşım bağlantısı oluşturulamaz.
        </p>
      ) : null}
      {link ? (
        <div className="mt-4 rounded-lg bg-neutral-50 p-3 ring-1 ring-black/5">
          <a
            className="block break-all text-sm text-sky-800 underline"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            {link}
          </a>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white px-2.5 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <ClipboardDocumentIcon className="size-4" aria-hidden="true" />
              Linki Kopyala
            </button>
            <button
              type="button"
              onClick={() => void revokeLink()}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              Bağlantıyı kaldır
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-neutral-600">
          {message}
        </p>
      ) : null}
    </section>
  );
}
