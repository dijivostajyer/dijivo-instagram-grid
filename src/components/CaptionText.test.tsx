// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import CaptionText from "./CaptionText";
import ShareGridClient from "./ShareGridClient";
import PostModal from "./PostModal";
import { computeGrid } from "@/lib/grid";
import { createShareSnapshot, deserializeShareSnapshot } from "@/lib/share";
import type { ExistingPost } from "@/lib/types";

afterEach(cleanup);

const CAPTION = "Birinci satır\nİkinci satır\n\nÜçüncü  satır (çift boşluk) #şükran\n\n";
const brand = { id: "b", name: "Marka", username: "marka" };
const post: ExistingPost = { id: "post-1", source: "mevcut", imageUrl: "https://cdn.test/p.jpg", alt: "Gönderi 1", recencyIndex: 0, pinned: false, postType: "post", caption: CAPTION };
const isPreview = (_: string, element: Element | null) => element?.tagName === "P" && element.textContent === `${brand.username} ${CAPTION}`;

describe("caption satır/boşluk korunumu", () => {
  it("CaptionText metni birebir çıkarır (hashtag sonrası ek boşluk yok, trim yok)", () => {
    const { container } = render(<p><CaptionText caption={CAPTION} /></p>);
    expect(container.textContent).toBe(CAPTION);
    expect(container.querySelector("span.text-sky-700")?.textContent).toBe("#şükran");
  });

  it("editör modalındaki önizleme pre-wrap ile aynı metni gösterir", () => {
    render(
      <PostModal post={post} source="mevcut" brand={brand} allProjects={[]} brands={[brand]}
        onPostTypeChange={() => undefined} onCaptionChange={() => undefined}
        onChangeImage={async () => undefined} onCopy={() => null} onClose={() => undefined} />,
    );
    const textarea = document.getElementById("modal-caption") as HTMLTextAreaElement;
    expect(textarea.value).toBe(CAPTION);
    expect(screen.getAllByText(isPreview)[0].className).toContain("whitespace-pre-wrap");
  });

  it("müşteri paylaşım sayfasındaki modal aynı biçimi korur ve snapshot roundtrip'te metin değişmez", () => {
    const snapshot = createShareSnapshot(
      { brand, cells: [{ id: "post-1", source: "mevcut", imageUrl: "https://cdn.test/p.jpg", position: 0, row: 0, column: 0, pinned: false, caption: CAPTION }] },
      "3e1a1c76-7958-4d4f-86c6-2727195fd44c",
      "2026-10-30T12:00:00.000Z",
    );
    expect(deserializeShareSnapshot(JSON.stringify(snapshot))?.cells[0].caption).toBe(CAPTION);

    render(<ShareGridClient brand={brand} result={computeGrid([post], [])} stories={[]} token="11111111-1111-4111-8111-111111111111" />);
    fireEvent.click(screen.getByRole("button", { name: "Gönderi 1" }));
    const dialog = screen.getByRole("dialog", { name: /Paylaşım gönderisi/ });
    expect(within(dialog).getAllByText(isPreview)[0].className).toContain("whitespace-pre-wrap");
  });
});
