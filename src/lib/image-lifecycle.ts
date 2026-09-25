import { deleteStoredImage, isImageRef } from "./image-store";
import type { PersistedAppState } from "./storage";

type ObjectUrlRevoker = (objectUrl: string) => void;
type StoredImageDeleter = (ref: string) => Promise<void>;

function imageUrls(state: PersistedAppState): string[] {
  return [
    state.brand.profileImageUrl,
    ...state.existingPosts.map((post) => post.imageUrl),
    ...state.plannedPosts.map((post) => post.imageUrl),
  ].filter((url): url is string => typeof url === "string");
}

/** State içinde hâlen ekranda kullanılan object URL'leri döndürür. */
export function activeObjectUrls(state: PersistedAppState): Set<string> {
  return new Set(imageUrls(state).filter((url) => url.startsWith("blob:")));
}

function activeImageRefs(
  state: PersistedAppState,
  refByObjectUrl: ReadonlyMap<string, string>,
): Set<string> {
  const refs = new Set<string>();
  for (const url of imageUrls(state)) {
    if (isImageRef(url)) refs.add(url);
    const ref = refByObjectUrl.get(url);
    if (ref !== undefined) refs.add(ref);
  }
  return refs;
}

/**
 * State'ten çıkan yüklemelerin geçici URL'lerini ve artık kullanılmayan
 * IndexedDB Blob'larını temizler. Her hata yakalanır; kullanıcı akışı sürer.
 */
export async function cleanUpRemovedImages({
  previousState,
  nextState,
  refByObjectUrl,
  trackedObjectUrls,
  revokeObjectUrl = URL.revokeObjectURL,
  deleteStoredImage: removeStoredImage = deleteStoredImage,
}: {
  previousState: PersistedAppState;
  nextState: PersistedAppState;
  refByObjectUrl: Map<string, string>;
  trackedObjectUrls: Set<string>;
  revokeObjectUrl?: ObjectUrlRevoker;
  deleteStoredImage?: StoredImageDeleter;
}): Promise<void> {
  const nextObjectUrls = activeObjectUrls(nextState);
  const removedObjectUrls = [...activeObjectUrls(previousState)].filter(
    (objectUrl) => !nextObjectUrls.has(objectUrl),
  );
  const refsToDelete = new Set<string>();

  for (const objectUrl of removedObjectUrls) {
    const ref = refByObjectUrl.get(objectUrl);
    refByObjectUrl.delete(objectUrl);
    trackedObjectUrls.delete(objectUrl);
    if (ref !== undefined) refsToDelete.add(ref);
    try {
      revokeObjectUrl(objectUrl);
    } catch (error) {
      console.warn("[persistence] Object URL temizlenemedi:", error);
    }
  }

  const refsStillInUse = activeImageRefs(nextState, refByObjectUrl);
  for (const ref of refsToDelete) {
    if (refsStillInUse.has(ref)) continue;
    try {
      await removeStoredImage(ref);
    } catch (error) {
      console.warn("[persistence] Kalıcı görsel silinemedi:", error);
    }
  }
}

/** Component kapanırken yalnızca geçici object URL'leri serbest bırakır. */
export function revokeTrackedObjectUrls({
  refByObjectUrl,
  trackedObjectUrls,
  revokeObjectUrl = URL.revokeObjectURL,
}: {
  refByObjectUrl: Map<string, string>;
  trackedObjectUrls: Set<string>;
  revokeObjectUrl?: ObjectUrlRevoker;
}): void {
  for (const objectUrl of trackedObjectUrls) {
    try {
      revokeObjectUrl(objectUrl);
    } catch (error) {
      console.warn("[persistence] Object URL temizlenemedi:", error);
    }
  }
  trackedObjectUrls.clear();
  refByObjectUrl.clear();
}
