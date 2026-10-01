"use client";

import { SquaresPlusIcon } from "@heroicons/react/16/solid";

import BrandForm from "@/components/BrandForm";
import type { NewBrandInput } from "@/hooks/use-persisted-grid";
import type { Brand } from "@/lib/types";

/**
 * İlk açılış onboarding ekranı: henüz marka yoksa
 * "Henüz marka yok / İlk markanızı oluşturun" görünümü
 * gösterilir (§2/§22). Marka adı + Instagram kullanıcı
 * adı olmadan gerçek workspace başlatılmaz.
 */
export default function Onboarding({
  onCreate,
}: {
  onCreate: (input: NewBrandInput) => Brand | null;
}) {
  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-sky-700 text-white">
            <SquaresPlusIcon className="size-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Dijivo Grid
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Henüz marka yok
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            İlk markanızı oluşturun; aylık planlarınız ve grid
            önizlemeniz burada birleşir.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,.05)]">
          <BrandForm
            submitLabel="Marka oluştur"
            onSubmit={(input) => {
              onCreate(input);
            }}
          />
          <p className="mt-4 border-t border-slate-100 pt-4 text-center text-xs text-neutral-500">
            Zorunlu alanları doldurduysanız ilerleyebilirsiniz;
            isteğe bağlı alanları "<b>Gelişmiş alanlar</b>" üzerinden
            sonradan da tamamlayabilirsiniz.
          </p>
        </div>
      </div>
    </div>
  );
}
