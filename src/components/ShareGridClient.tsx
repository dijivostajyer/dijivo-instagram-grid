"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import {
  feedbackTargetKey,
  feedbackTargetTypeForPost,
  latestFeedbackByTarget,
  type FeedbackAction,
  type FeedbackTargetType,
  type PublicFeedbackRecord,
} from "@/lib/share-feedback";
import type { Brand, GridResult, Story } from "@/lib/types";
import GridPreview from "./GridPreview";
import ShareFeedbackPanel from "./ShareFeedbackPanel";
import SharePostModal from "./SharePostModal";

/** Müşterinin beyan ettiği ad aynı tarayıcıda tekrar sorulmaz (kimlik değildir). */
const CLIENT_NAME_KEY = "dijivo-share-client-name";

function readStoredName(): string {
  try {
    return window.localStorage.getItem(CLIENT_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `/share/[token]` client katmanı. Grid salt-okunur kalır; müşteri her Post,
 * Reel, Story ve tüm grid için onay / revize geri bildirimi verebilir.
 * Geri bildirimler token ile sunucuya gider; tarih sunucuda oluşur.
 */
export default function ShareGridClient({
  brand,
  result,
  stories,
  token,
  initialFeedback = [],
}: {
  brand: Brand;
  result: GridResult;
  stories?: Story[];
  /** Verilmezse geri bildirim alanları gösterilmez (salt-okunur). */
  token?: string;
  initialFeedback?: PublicFeedbackRecord[];
}) {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [records, setRecords] = useState<PublicFeedbackRecord[]>(initialFeedback);
  const [clientName, setClientName] = useState("");
  const selectedPost =
    result.cells.find((cell) => cell.post.id === selectedPostId)?.post ?? null;

  useEffect(() => setClientName(readStoredName()), []);

  const latest = useMemo(() => latestFeedbackByTarget(records), [records]);
  const latestFor = (targetType: FeedbackTargetType, targetId: string | null) =>
    latest.get(feedbackTargetKey(targetType, targetId));

  const rememberName = useCallback((name: string) => {
    setClientName(name);
    try {
      window.localStorage.setItem(CLIENT_NAME_KEY, name);
    } catch {
      // Depolama kapalıysa ad yalnız bu sayfada kalır.
    }
  }, []);

  const submit = useCallback(
    async (targetType: FeedbackTargetType, targetId: string | null, action: FeedbackAction, message: string | null, name: string) => {
      if (!token) throw new Error("Geri bildirim bu paylaşımda kullanılamıyor.");
      let response: Response;
      try {
        response = await fetch(withBasePath(`/api/shares/${token}/feedback`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, action, message, clientName: name }),
        });
      } catch {
        throw new Error("Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.");
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || !isRecord(body.feedback)) {
        throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "Geri bildirim kaydedilemedi. Lütfen tekrar deneyin.");
      }
      setRecords((current) => [...current, body.feedback as PublicFeedbackRecord]);
    },
    [token],
  );

  const panelFor = (
    targetType: FeedbackTargetType,
    targetId: string | null,
    options: { tone?: "light" | "dark"; onActiveChange?: (active: boolean) => void } = {},
  ) =>
    token ? (
      <ShareFeedbackPanel
        latest={latestFor(targetType, targetId)}
        clientName={clientName}
        onClientNameChange={rememberName}
        onSubmit={(action, message, name) => submit(targetType, targetId, action, message, name)}
        tone={options.tone}
        onActiveChange={options.onActiveChange}
      />
    ) : null;

  return (
    <>
      {token ? (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          İçeriklere ve Story&apos;lere dokunarak tek tek onay verebilir veya revize isteyebilirsiniz. Tüm grid için geri bildirim sayfanın altındadır.
        </p>
      ) : null}
      <GridPreview
        brand={brand}
        result={result}
        onSelectPost={setSelectedPostId}
        selectedPostId={selectedPostId}
        stories={stories}
        cellStatus={token ? (cell) => latestFor(feedbackTargetTypeForPost(cell.post.postType), cell.post.id)?.action : undefined}
        renderStoryFooter={token ? (story, controls) => panelFor("story", story.id, { tone: "dark", onActiveChange: controls.setPaused }) : undefined}
      />
      {token ? (
        <section aria-labelledby="grid-feedback-title" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 id="grid-feedback-title" className="text-base font-semibold text-neutral-900">Grid Hakkında Geri Bildirim</h2>
          <p className="mt-1 mb-4 text-sm text-neutral-500">Gridin bütününü onaylayın veya genel bir revize isteyin.</p>
          <ShareFeedbackPanel
            latest={latestFor("grid", null)}
            approveLabel="Grid'i Onayladım"
            reviseLabel="Genel Revize İste"
            approveQuestion="Gridin tamamını onaylıyor musunuz?"
            approvedMessage="Grid onaylandı."
            clientName={clientName}
            onClientNameChange={rememberName}
            onSubmit={(action, message, name) => submit("grid", null, action, message, name)}
          />
        </section>
      ) : null}
      {selectedPost ? (
        <SharePostModal
          post={selectedPost}
          brand={brand}
          onClose={() => setSelectedPostId(null)}
          footer={panelFor(feedbackTargetTypeForPost(selectedPost.postType), selectedPost.id)}
        />
      ) : null}
    </>
  );
}
