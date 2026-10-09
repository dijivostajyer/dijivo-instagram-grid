import { describe, it, expect } from "vitest";
import { normalizeInstagramProfile, parseInstagramUrl } from "./normalize";

describe("Instagram URL parsing", () => {
  it("instagram.com/username formatı parse eder", () => {
    const result = parseInstagramUrl("https://instagram.com/dijivo");
    expect(result.ok).toBe(true);
    expect(result.username).toBe("dijivo");
  });

  it("instagram.com/username/ formatı parse eder", () => {
    const result = parseInstagramUrl("https://instagram.com/dijivo/");
    expect(result.ok).toBe(true);
    expect(result.username).toBe("dijivo");
  });

  it("www.instagram.com/username formatı parse eder", () => {
    const result = parseInstagramUrl("https://www.instagram.com/dijivo");
    expect(result.ok).toBe(true);
    expect(result.username).toBe("dijivo");
  });

  it("http protocol ile çalışır", () => {
    const result = parseInstagramUrl("http://instagram.com/dijivo");
    expect(result.ok).toBe(true);
    expect(result.username).toBe("dijivo");
  });

  it("protocol olmadan çalışır", () => {
    const result = parseInstagramUrl("instagram.com/dijivo");
    expect(result.ok).toBe(true);
    expect(result.username).toBe("dijivo");
  });

  it("@username formatı reddeder", () => {
    const result = parseInstagramUrl("@dijivo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("URL formatında girin");
  });

  it("post URL reddeder", () => {
    const result = parseInstagramUrl("https://instagram.com/p/ABC123/");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("profil URL'si girin");
  });

  it("reel URL reddeder", () => {
    const result = parseInstagramUrl("https://instagram.com/reel/ABC123/");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("profil URL'si girin");
  });

  it("boş URL reddeder", () => {
    const result = parseInstagramUrl("");
    expect(result.ok).toBe(false);
  });

  it("geçersiz domain reddeder", () => {
    const result = parseInstagramUrl("https://example.com/dijivo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Instagram profil bağlantısı");
  });

  it("instagram.com benzeri kötü niyetli domaini reddeder", () => {
    expect(parseInstagramUrl("https://evilinstagram.com/dijivo").ok).toBe(false);
  });

  it("fazladan path içeren profil URL'sini reddeder", () => {
    expect(parseInstagramUrl("https://instagram.com/dijivo/extra").ok).toBe(false);
  });

  it("kısmi provider verisini güvenli biçimde normalize eder", () => {
    const profile = normalizeInstagramProfile({
      username: "@dijivo",
      biography: "  Merhaba  ",
      followersCount: 12,
      profileImageUrl: "javascript:alert(1)",
      recentPosts: [
        { id: "post-1", type: "post", thumbnailUrl: "https://cdn.example.test/post.jpg" },
        { id: "bozuk", type: "post", thumbnailUrl: "javascript:alert(1)" },
      ],
      highlights: [{ id: "h1", title: " Kampanya ", coverUrl: "https://cdn.example.test/cover.jpg" }],
    });
    expect(profile.username).toBe("dijivo");
    expect(profile.profileImageUrl).toBeUndefined();
    expect(profile.recentPosts).toHaveLength(1);
    expect(profile.highlights?.[0]).toMatchObject({ title: "Kampanya" });
  });
});
