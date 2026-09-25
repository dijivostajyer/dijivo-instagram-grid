import { describe, expect, it } from "vitest";

import { buildFileName, slugify } from "./export";
import type { Brand, ExistingPost, PlannedPost } from "./types";

function existing(overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id: "e1",
    source: "mevcut",
    imageUrl: "/img/e1.jpg",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function planned(overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    id: "p1",
    source: "planlanan",
    imageUrl: "/img/p1.jpg",
    planOrder: 0,
    ...overrides,
  };
}

describe("slugify", () => {
  it("boş ve boşluk içeren isimleri güvenli dosya adına çevirir", () => {
    expect(slugify("  Dijivo  İnstagram  ")).toBe("dijivo-instagram");
    expect(slugify("")).toBe("instagram-grid");
    // disliked characters trimmed
    expect(slugify("Marka Adi!")).toBe("marka-adi");
  });
});

describe("buildFileName", () => {
  it("marka adına göre doğru uzantıyla dosya adı oluşturur", () => {
    const brand = { id: "x", name: "Dijivo Demo Marka", username: "dijivo" } as Brand;
    expect(buildFileName(brand, "pdf")).toBe("dijivo-demo-marka.pdf");
    expect(buildFileName(brand, "jpg")).toBe("dijivo-demo-marka.jpg");
  });
});
