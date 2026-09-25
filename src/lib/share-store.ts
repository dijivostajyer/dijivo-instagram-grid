import {
  createShareSnapshot,
  deserializeShareSnapshot,
  serializeShareSnapshot,
  type ShareSnapshot,
  type ShareSnapshotInput,
} from "./share";
import { generateShareToken, isValidShareToken } from "./share-token";
import { SupabaseShareStore, createSupabaseShareDriver } from "./supabase-share-store";
import { getShareStorageConfig } from "./share-config";

/** Production veritabanı adapter'ının karşılayacağı paylaşım depolama sözleşmesi. */
export interface ShareStore {
  create(input: ShareSnapshotInput): Promise<ShareSnapshot>;
  get(token: string): Promise<ShareSnapshot | null>;
  revoke(token: string): Promise<void>;
}

export class InMemoryShareStore implements ShareStore {
  private readonly records = new Map<string, string>();

  constructor(
    private readonly createToken: () => string = generateShareToken,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: ShareSnapshotInput): Promise<ShareSnapshot> {
    const snapshot = createShareSnapshot(input, this.createToken(), this.now().toISOString());
    // JSON roundtrip, çağıranın sonraki mutasyonlarının snapshot'ı etkilemesini önler.
    this.records.set(snapshot.token, serializeShareSnapshot(snapshot));
    return deserializeShareSnapshot(this.records.get(snapshot.token)) ?? snapshot;
  }

  async get(token: string): Promise<ShareSnapshot | null> {
    if (!isValidShareToken(token)) return null;
    return deserializeShareSnapshot(this.records.get(token));
  }

  async revoke(token: string): Promise<void> {
    if (!isValidShareToken(token)) return;
    this.records.delete(token);
  }
}

declare global {
  // Next.js development route modülleri yeniden yüklense de aynı uygulama
  // sürecindeki snapshot'ların erişilebilir kalması için process-geneli kayıt.
  // eslint-disable-next-line no-var
  var dijivoShareStore: ShareStore | undefined;
}

/**
 * Geçici MVP adapter'ı: tek Node sürecinin belleğinde yaşar. Gerçek production
 * dağıtımı için bunun yerine paylaşılan, kalıcı bir database/object storage adapter'ı gerekir.
 */
export function shouldUseSupabase(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

export function getShareStore(env: NodeJS.ProcessEnv = process.env): ShareStore {
  if (shouldUseSupabase(env)) {
    const config = getShareStorageConfig(env);
    return new SupabaseShareStore(createSupabaseShareDriver(config), config.ttlDays);
  }
  if (env.NODE_ENV === "production") throw new Error("Supabase paylaşım storage yapılandırması eksik.");
  return globalThis.dijivoShareStore ?? (globalThis.dijivoShareStore = new InMemoryShareStore());
}
