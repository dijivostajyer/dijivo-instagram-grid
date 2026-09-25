import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, validateImageFile } from "./validators";

function fakeFile(type: string, size: number): File {
  return { type, size } as unknown as File;
}

describe("validateImageFile", () => {
  it("JPEG, PNG ve WebP kabul eder", () => {
    expect(validateImageFile(fakeFile("image/jpeg", 1000)).ok).toBe(true);
    expect(validateImageFile(fakeFile("image/png", 1000)).ok).toBe(true);
    expect(validateImageFile(fakeFile("image/webp", 1000)).ok).toBe(true);
  });

  it("desteklenmeyen tür için Türkçe hata döndürür", () => {
    const result = validateImageFile(fakeFile("image/gif", 1000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Desteklenmeyen dosya türü");
  });

  it("10 MB üstü için boyut hatası döndürür", () => {
    const result = validateImageFile(
      fakeFile("image/png", MAX_IMAGE_BYTES + 1),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("çok büyük");
  });

  it("tam 10 MB kabul edilir", () => {
    expect(validateImageFile(fakeFile("image/png", MAX_IMAGE_BYTES)).ok).toBe(
      true,
    );
  });

  it("boş dosya için hata döndürür", () => {
    const result = validateImageFile(fakeFile("image/png", 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Boş dosya");
  });
});
