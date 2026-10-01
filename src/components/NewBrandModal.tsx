"use client";

import { useEffect, useRef } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

import BrandForm from "@/components/BrandForm";
import type { NewBrandInput } from "@/hooks/use-persisted-grid";
import type { Brand } from "@/lib/types";

/**
 * '+ Yeni Marka' diyalogu (§3): yeni kimlik doğrulama gerekmez;
 * mevcut workspace'a marka ekler. Escape / arka plan tıklayarak
 * kapatılır; kapanış düğmesine otomatik odaklanılır.
 */
export default function NewBrandModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: NewBrandInput) => Brand | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Yeni marka oluştur">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative my-8 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Yeni marka
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Mevcut workspace'a marka ekleyin; yeni giriş gerekmez.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <XMarkIcon className="size-5" aria-hidden="true" />
          </button>
        </div>
        <BrandForm
          submitLabel="Marka ekle"
          onSubmit={(input) => {
            const created = onCreate(input);
            if (created) onClose();
          }}
        />
      </div>
    </div>
  );
}
