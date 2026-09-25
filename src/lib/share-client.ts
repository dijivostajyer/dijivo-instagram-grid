"use client";

import {
  shareInputFromGrid,
  type ShareSnapshotInput,
} from "./share";
import type { Brand, GridResult } from "./types";

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

async function imageUrlForShare(url: string, fetchImage: typeof fetch): Promise<string> {
  if (!url.startsWith("blob:")) return url;
  const response = await fetchImage(url);
  if (!response.ok) throw new Error("Yüklenen görsel paylaşım için okunamadı.");
  const blob = await response.blob();
  if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) {
    throw new Error("Yüklenen görsel paylaşım için desteklenmiyor.");
  }
  return `data:${blob.type};base64,${base64FromBytes(new Uint8Array(await blob.arrayBuffer()))}`;
}

/** blob URL'lerini taşınabilir data URL'e çevirir; idb/blob referansı bırakmaz. */
export async function prepareShareInput(
  brand: Brand,
  result: GridResult,
  fetchImage: typeof fetch = fetch,
): Promise<ShareSnapshotInput> {
  const input = shareInputFromGrid(brand, result);
  const profileImageUrl = input.brand.profileImageUrl
    ? await imageUrlForShare(input.brand.profileImageUrl, fetchImage)
    : undefined;
  return {
    brand: { ...input.brand, profileImageUrl },
    cells: await Promise.all(
      input.cells.map(async (cell) => ({
        ...cell,
        imageUrl: await imageUrlForShare(cell.imageUrl, fetchImage),
      })),
    ),
  };
}
