import { describe, expect, it } from "vitest";

import { toWorkspaceMediaRef, workspaceMediaRefFromSignedUrl } from "./workspace-media-store";

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

describe("toWorkspaceMediaRef", () => {
  it("ref, imzalı URL ve eşlenmiş object URL'i aynı kanonik referansa çevirir", () => {
    const ref = "storage:workspace-media/user-1/brand-1/story/a.jpg";
    expect(toWorkspaceMediaRef(ref)).toBe(ref);
    expect(toWorkspaceMediaRef("https://project.supabase.co/storage/v1/object/sign/workspace-media/user-1/brand-1/story/a.jpg?token=x")).toBe(ref);
    expect(toWorkspaceMediaRef("blob:https://app.test/1", new Map([["blob:https://app.test/1", ref]]))).toBe(ref);
    expect(toWorkspaceMediaRef("blob:https://app.test/2")).toBeUndefined();
    expect(toWorkspaceMediaRef(undefined)).toBeUndefined();
  });
});
