import { describe, expect, it } from "vitest";

import { computeGrid } from "./grid";
import {
  createShareSnapshot,
  deserializeShareSnapshot,
  serializeShareSnapshot,
  shareInputFromGrid,
  type ShareSnapshotInput,
} from "./share";
import { InMemoryShareStore } from "./share-store";
import { generateShareToken, isValidShareToken } from "./share-token";
import type { Brand, ExistingPost, PlannedPost } from "./types";

const TOKEN = "3e1a1c76-7958-4d4f-86c6-2727195fd44c";
const CREATED_AT = "2026-09-25T12:00:00.000Z";

const BRAND: Brand = {
  id: "brand-1",
  name: "Dijivo",
  username: "dijivo",
  bio: "Grid sunumu",
  profileImageUrl: "https://example.com/profile.jpg",
};

function input(overrides: Partial<ShareSnapshotInput> = {}): ShareSnapshotInput {
  return {
    brand: {
      name: BRAND.name,
      username: BRAND.username,
      bio: BRAND.bio,
      profileImageUrl: BRAND.profileImageUrl,
    },
    cells: [
      {
        id: "post-1",
        source: "mevcut",
        imageUrl: "https://example.com/post-1.jpg",
        alt: "Gönderi 1",
        position: 0,
        row: 0,
        column: 0,
        pinned: true,
      },
    ],
    ...overrides,
  };
}

describe("share token", () => {
  it("UUID biçiminde, tahmin edilemeyen token üretir", () => {
    expect(generateShareToken(() => TOKEN)).toBe(TOKEN);
    expect(isValidShareToken(TOKEN)).toBe(true);
    expect(isValidShareToken("42")).toBe(false);
  });
});

describe("share snapshot", () => {
  it("serialize/validation roundtrip brand bilgilerini korur", () => {
    const snapshot = createShareSnapshot(input(), TOKEN, CREATED_AT);
    expect(deserializeShareSnapshot(serializeShareSnapshot(snapshot))).toEqual(snapshot);
    expect(snapshot.brand).toEqual({
      name: "Dijivo",
      username: "dijivo",
      bio: "Grid sunumu",
      profileImageUrl: "https://example.com/profile.jpg",
    });
  });

  it("hesaplanmış grid sırasını, pinned ve kaynak bilgisini korur", () => {
    const existing: ExistingPost[] = [
      { id: "old", source: "mevcut", imageUrl: "https://example.com/old.jpg", recencyIndex: 1, pinned: false },
      { id: "pin", source: "mevcut", imageUrl: "https://example.com/pin.jpg", recencyIndex: 2, pinned: true, pinnedOrder: 0 },
    ];
    const planned: PlannedPost[] = [
      { id: "plan", source: "planlanan", imageUrl: "https://example.com/plan.jpg", planOrder: 0 },
    ];
    const snapshot = createShareSnapshot(
      shareInputFromGrid(BRAND, computeGrid(existing, planned)),
      TOKEN,
      CREATED_AT,
    );

    expect(snapshot.cells.map((cell) => [cell.id, cell.source, cell.pinned])).toEqual([
      ["pin", "mevcut", true],
      ["plan", "planlanan", false],
      ["old", "mevcut", false],
    ]);
    expect(snapshot.cells.map((cell) => cell.position)).toEqual([0, 1, 2]);
  });

  it("boş grid paylaşımını reddeder", () => {
    expect(() => createShareSnapshot(input({ cells: [] }), TOKEN, CREATED_AT)).toThrow(
      "Paylaşılabilir grid bulunamadı.",
    );
  });

  it("bozuk snapshot için güvenli fallback döner", () => {
    expect(deserializeShareSnapshot("{bozuk")).toBeNull();
    expect(deserializeShareSnapshot(JSON.stringify({ version: 1, token: TOKEN }))).toBeNull();
  });

  it("blob ve idb görsel referanslarını snapshot'a yazmaz", () => {
    expect(() =>
      createShareSnapshot(
        input({
          cells: [{ ...input().cells[0], imageUrl: "blob:https://editor.test/image" }],
        }),
        TOKEN,
        CREATED_AT,
      ),
    ).toThrow("Paylaşılabilir grid bulunamadı.");
    expect(() =>
      createShareSnapshot(
        input({ brand: { ...input().brand, profileImageUrl: "idb:uploaded-image" } }),
        TOKEN,
        CREATED_AT,
      ),
    ).toThrow("Paylaşılabilir grid bulunamadı.");
  });
});

describe("in-memory ShareStore adapter", () => {
  it("bulunamayan veya geçersiz token için null döner", async () => {
    const store = new InMemoryShareStore(() => TOKEN, () => new Date(CREATED_AT));
    await expect(store.get("bad-token")).resolves.toBeNull();
    await expect(store.get("f4a2e882-769f-4a1b-801f-3409a430afcb")).resolves.toBeNull();
  });

  it("immutable snapshot saklar; editor girdisindeki sonraki değişiklikler linki değiştirmez", async () => {
    const store = new InMemoryShareStore(() => TOKEN, () => new Date(CREATED_AT));
    const source = input();
    const created = await store.create(source);
    source.brand.name = "Değiştirildi";
    source.cells[0].imageUrl = "https://example.com/new.jpg";

    const restored = await store.get(created.token);
    expect(restored?.brand.name).toBe("Dijivo");
    expect(restored?.cells[0].imageUrl).toBe("https://example.com/post-1.jpg");
  });
});
