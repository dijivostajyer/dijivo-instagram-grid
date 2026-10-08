import { describe, expect, it } from "vitest";

import { workspaceMediaRefFromSignedUrl } from "./workspace-media-store";

describe("workspaceMediaRefFromSignedUrl", () => {
  it("hydrates edilmiş imzalı URL'i tekrar workspace-media referansına bağlar", () => {
    expect(workspaceMediaRefFromSignedUrl(
      "https://project.supabase.co/storage/v1/object/sign/workspace-media/user-1/brand-1/post/file.jpg?token=abc",
    )).toBe("storage:workspace-media/user-1/brand-1/post/file.jpg");
  });

  it("workspace-media dışındaki URL'leri kabul etmez", () => {
    expect(workspaceMediaRefFromSignedUrl(
      "https://project.supabase.co/storage/v1/object/sign/share-images/file.jpg?token=abc",
    )).toBeUndefined();
  });
});
