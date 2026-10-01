"use client";

import SharePanel, { type ShareController } from "@/components/SharePanel";
import type { GridResult } from "@/lib/types";

/**
 * Salt-okunur paylaşım sayfası. Oluştur/kopyala/aç/iptal akışı SharePanel'dedir;
 * bağlantı durumu controller ile üst bileşende tutulur (sayfa değişiminde kaybolmaz).
 */
export default function ShareWorkspace({
  result,
  controller,
}: {
  result: GridResult;
  controller: ShareController;
}) {
  return (
    <div className="mx-auto max-w-[760px]">
      <p className="mb-6 text-sm text-neutral-500">
        Anlık gridin sabit kopyasını oluşturup müşteriye gönderin. Alıcı yalnızca görüntüler;
        düzenleme, silme veya yükleme yapamaz.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <SharePanel result={result} controller={controller} />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-neutral-900">Nasıl çalışır?</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">
          <li>Bağlantı, oluşturduğu andaki gridin kopyasını açar; sonraki düzenlemeleri etkilemez.</li>
          <li>Bağlantı token’ı bilen herkes açar; ek yetkilendirme yoktur (bilinçli sınırlama).</li>
          <li>“Bağlantıyı kaldır” ile bağlantı anında geçersizleşir.</li>
          <li>Bağlantılar üretim ortamında Supabase’de saklanır (varsayılan 30 gün).</li>
        </ul>
      </div>
    </div>
  );
}
