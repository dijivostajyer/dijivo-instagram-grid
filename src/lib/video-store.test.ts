import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import {
  VIDEO_REF_PREFIX,
  clearStoredVideos,
  deleteStoredVideo,
  isVideoRef,
  loadVideoAsObjectUrl,
  makeVideoRef,
  newVideoId,
  persistVideoObjectUrl,
  videoRefId,
} from "./video-store";

/** Geçerli MP4 magic byte'ları içeren test videosu. */
function videoBlob(size = 64, type = "video/mp4"): Blob {
  const bytes = new Uint8Array(size);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  return new Blob([bytes], { type });
}

describe("video ref yardımcıları", () => {
  it("makeVideoRef / isVideoRef / videoRefId çevrimi", () => {
    const ref = makeVideoRef("abc-123");
    expect(ref).toBe(`${VIDEO_REF_PREFIX}abc-123`);
    expect(isVideoRef(ref)).toBe(true);
    expect(videoRefId(ref)).toBe("abc-123");
  });

  it("referans olmayan değerler reddedilir", () => {
    expect(isVideoRef("blob:https://editor.test/v.mp4")).toBe(false);
    expect(isVideoRef("idb:uploaded-image")).toBe(false);
    expect(isVideoRef("https://cdn.test/reel.mp4")).toBe(false);
    expect(videoRefId("idb-video:")).toBeNull();
    expect(videoRefId("https://cdn.test/reel.mp4")).toBeNull();
  });

  it("newVideoId benzersiz kimlik üretir", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newVideoId()));
    expect(ids.size).toBe(50);
  });
});

describe("Reel yerel kalıcılık (§6/§22)", () => {
  it("persist + load roundtrip: blob içeriği ve türü korunur", async () => {
    const blob = videoBlob(128);
    const objectUrl = URL.createObjectURL(blob);
    const ref = await persistVideoObjectUrl(objectUrl);
    expect(ref.startsWith(VIDEO_REF_PREFIX)).toBe(true);

    const loaded = await loadVideoAsObjectUrl(ref);
    expect(loaded).not.toBeNull();
    expect(loaded!.startsWith("blob:")).toBe(true);
    const response = await fetch(loaded!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect((await response.blob()).size).toBe(128);

    URL.revokeObjectURL(objectUrl);
    URL.revokeObjectURL(loaded!);
  });

  it("aynı referans iki kez yüklenebilir (kopya/lifecycle güvenliği, §21)", async () => {
    const blob = videoBlob(48, "video/webm");
    const ref = await persistVideoObjectUrl(URL.createObjectURL(blob));
    const first = await loadVideoAsObjectUrl(ref);
    const second = await loadVideoAsObjectUrl(ref);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Her yükleme yeni bir object URL üretir; ikisi de çalışır.
    expect(first).not.toBe(second);
    const firstBlob = await (await fetch(first!)).blob();
    const secondBlob = await (await fetch(second!)).blob();
    expect(firstBlob.size).toBe(secondBlob.size);
    expect(firstBlob.type).toBe("video/webm");
    URL.revokeObjectURL(first!);
    URL.revokeObjectURL(second!);
  });

  it("silinen video referansı null döner", async () => {
    const ref = await persistVideoObjectUrl(
      URL.createObjectURL(videoBlob()),
    );
    await deleteStoredVideo(ref);
    expect(await loadVideoAsObjectUrl(ref)).toBeNull();
  });

  it("bilinmeyen referans null döner", async () => {
    expect(await loadVideoAsObjectUrl(makeVideoRef("yok"))).toBeNull();
  });

  it("referans olmayan URL'ler yüklenemez", async () => {
    expect(
      await loadVideoAsObjectUrl("blob:https://editor.test/v.mp4"),
    ).toBeNull();
    expect(await loadVideoAsObjectUrl("idb-video:")).toBeNull();
    expect(await loadVideoAsObjectUrl("idb:uploaded")).toBeNull();
  });

  it("clearStoredVideos depodaki tüm videoları siler", async () => {
    const refA = await persistVideoObjectUrl(
      URL.createObjectURL(videoBlob()),
    );
    const refB = await persistVideoObjectUrl(
      URL.createObjectURL(videoBlob()),
    );
    await clearStoredVideos();
    expect(await loadVideoAsObjectUrl(refA)).toBeNull();
    expect(await loadVideoAsObjectUrl(refB)).toBeNull();
  });

  it("silme/temizleme hataları uygulamayı düşürmez", async () => {
    await expect(deleteStoredVideo(makeVideoRef("yok"))).resolves.toBeUndefined();
    await expect(clearStoredVideos()).resolves.toBeUndefined();
  });
});