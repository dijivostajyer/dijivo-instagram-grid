"use client";

import { useState } from "react";

import { prepareShareInput } from "@/lib/share-client";
import type { Brand, GridResult } from "@/lib/types";

export default function SharePanel({
  brand,
  result,
}: {
  brand: Brand;
  result: GridResult;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createLink() {
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
        throw new Error(isErrorResponse(body) ? body.error : "Paylaşım bağlantısı oluşturulamadı.");
      }
      setLink(`${window.location.origin}/share/${body.token}`);
      setMessage("Salt-okunur paylaşım bağlantısı hazır.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Paylaşım bağlantısı oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Bağlantı panoya kopyalandı.");
    } catch (error) {
      console.warn("[share] Clipboard yazılamadı:", error);
      setMessage("Bağlantı kopyalanamadı; aşağıdaki bağlantıyı manuel kopyalayın.");
    }
  }

  const disabled = busy || result.cells.length === 0;
  return (
    <section className="mt-4 rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-2 text-sm font-semibold">Salt-okunur paylaşım</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Bu anki gridin sabit bir kopyasını oluşturur. Sonraki düzenlemeler bu
        bağlantıdaki görünümü değiştirmez.
      </p>
      <button
        type="button"
        onClick={() => void createLink()}
        disabled={disabled}
        className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Bağlantı hazırlanıyor…" : "Paylaşım Linki Oluştur"}
      </button>
      {result.cells.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">Grid boş: paylaşım bağlantısı oluşturulamaz.</p>
      ) : null}
      {link ? (
        <div className="mt-3 rounded bg-neutral-50 p-2">
          <a className="break-all text-xs text-sky-700 underline" href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="mt-2 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-white"
          >
            Linki Kopyala
          </button>
        </div>
      ) : null}
      {message ? <p role="status" className="mt-2 text-xs text-neutral-600">{message}</p> : null}
    </section>
  );
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
