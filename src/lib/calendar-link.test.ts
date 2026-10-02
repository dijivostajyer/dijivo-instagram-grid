import { describe, expect, it } from "vitest";

import {
  buildLinkedPostOptions,
  findPostById,
  resolveCalendarLink,
} from "./calendar-link";
import type { GridProject } from "./storage";
import type { ExistingPost, PlannedPost } from "./types";

function existing(id: string, overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id,
    source: "mevcut",
    imageUrl: `https://example.com/${id}.jpg`,
    aspectRatio: "1:1",
    postType: "post",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function planned(id: string, overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    id,
    source: "planlanan",
    imageUrl: `https://example.com/${id}.jpg`,
    aspectRatio: "1:1",
    postType: "post",
    planOrder: 0,
    ...overrides,
  };
}

function project(
  id: string,
  brandId: string | null | undefined,
  posts: { existing?: ExistingPost[]; planned?: PlannedPost[] } = {},
): GridProject {
  return {
    id,
    name: `Proje ${id}`,
    month: 10,
    year: 2026,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    brand: {
      id: brandId ?? "brand-a",
      name: "Marka",
      username: "marka",
    },
    brandId,
    existingPosts: posts.existing ?? [],
    plannedPosts: posts.planned ?? [],
  };
}

describe("findPostById", () => {
  const projects = [
    project("p1", "brand-a", {
      existing: [existing("e1")],
      planned: [planned("pl1")],
    }),
    project("p2", "brand-a", { planned: [planned("pl2")] }),
    project("p3", "brand-b", { existing: [existing("e2")] }),
  ];

  it("mevcut ve planlanan gönderileri tüm projelerde bulur", () => {
    expect(findPostById(projects, "e1")?.project.id).toBe("p1");
    expect(findPostById(projects, "pl1")?.project.id).toBe("p1");
    expect(findPostById(projects, "pl2")?.project.id).toBe("p2");
    expect(findPostById(projects, "e2")?.project.id).toBe("p3");
  });

  it("bilinmeyen/boş id için null", () => {
    expect(findPostById(projects, "yok")).toBeNull();
    expect(findPostById(projects, null)).toBeNull();
    expect(findPostById(projects, undefined)).toBeNull();
    expect(findPostById([], "e1")).toBeNull();
  });
});

describe("resolveCalendarLink", () => {
  const projects = [
    project("p1", "brand-a", { existing: [existing("e1")] }),
    // brandId'siz (eski veri) proje: aynı marka kabul edilir.
    project("p2", null, { planned: [planned("pl1")] }),
    project("p3", "brand-b", { existing: [existing("e2")] }),
  ];

  it("postId yoksa none", () => {
    expect(resolveCalendarLink(projects, null, "brand-a")).toEqual({
      status: "none",
    });
  });

  it("aynı markadaki post: ok", () => {
    const result = resolveCalendarLink(projects, "e1", "brand-a");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.link.post.id).toBe("e1");
      expect(result.link.project.id).toBe("p1");
    }
  });

  it("brandId'siz projenin post'u kabul edilir", () => {
    expect(resolveCalendarLink(projects, "pl1", "brand-a").status).toBe(
      "ok",
    );
  });

  it("silinmiş post: missing", () => {
    expect(resolveCalendarLink(projects, "silinmis", "brand-a")).toEqual({
      status: "missing",
    });
  });

  it("başka markanın post'u: cross-brand (kesin redd)", () => {
    expect(resolveCalendarLink(projects, "e2", "brand-a")).toEqual({
      status: "cross-brand",
    });
    // Aktif marka brand-b iken aynı post çözülebilir.
    expect(resolveCalendarLink(projects, "e2", "brand-b").status).toBe(
      "ok",
    );
  });
});

describe("buildLinkedPostOptions", () => {
  it("yalnızca aynı markanın gönderilerini listeler", () => {
    const projects = [
      project("p1", "brand-a", {
        existing: [existing("e1", { caption: "Kapak 1" })],
        planned: [planned("pl1", { alt: "Planlanan görsel" })],
      }),
      project("p2", "brand-b", {
        existing: [existing("e2", { caption: "Başka marka" })],
      }),
      project("p3", null, { planned: [planned("pl2")] }),
    ];
    const options = buildLinkedPostOptions(projects, "brand-a");
    expect(options.map((option) => option.postId).sort()).toEqual([
      "e1",
      "pl1",
      "pl2",
    ]);
    const first = options.find((option) => option.postId === "e1");
    expect(first).toMatchObject({
      projectId: "p1",
      label: "Kapak 1",
      postType: "post",
      hasVideo: false,
    });
    const video = options.find((option) => option.postId === "pl1");
    expect(video?.label).toBe("Planlanan görsel");
  });

  it("video gönderi işaretlenir", () => {
    const projects = [
      project("p1", "brand-a", {
        planned: [
          planned("v1", { mediaType: "video", videoUrl: "blob:x" }),
        ],
      }),
    ];
    const [option] = buildLinkedPostOptions(projects, "brand-a");
    expect(option.hasVideo).toBe(true);
  });

  it("boş proje listesi boş döner", () => {
    expect(buildLinkedPostOptions([], "brand-a")).toEqual([]);
  });
});
