"use client";

import { useState } from "react";

import type { Brand, GridResult } from "@/lib/types";
import GridPreview from "./GridPreview";
import SharePostModal from "./SharePostModal";

/**
 * `/share/[token]` gridi için client katmanı (Phase 2, §9).
 * Server component yalnızca snapshot'ı çeker; hücre tıklama
 * durumu ve salt-okunur `SharePostModal` burada yaşar.
 */
export default function ShareGridClient({
  brand,
  result,
}: {
  brand: Brand;
  result: GridResult;
}) {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const selectedPost =
    result.cells.find((cell) => cell.post.id === selectedPostId)?.post ?? null;

  return (
    <>
      <GridPreview
        brand={brand}
        result={result}
        onSelectPost={setSelectedPostId}
        selectedPostId={selectedPostId}
      />
      {selectedPost ? (
        <SharePostModal
          post={selectedPost}
          brand={brand}
          onClose={() => setSelectedPostId(null)}
        />
      ) : null}
    </>
  );
}
