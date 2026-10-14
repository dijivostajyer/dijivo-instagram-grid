/**
 * Süreç içi kayan pencere hız sınırlayıcı (bağımlılıksız).
 *
 * Tek Node sürecinde (cPanel) anahtar başına son N isteği tutar. Birden
 * fazla süreçte veya yeniden başlatmada sıfırlanır; bu yüzden kalıcı bir
 * üst sınır (ör. veritabanında paylaşım başına sayım) ile birlikte kullanılır.
 */
export interface RateLimiter {
  /** İzin verilirse isteği sayar ve true döner. */
  take(key: string): boolean;
}

export function createRateLimiter(options: { max: number; windowMs: number; now?: () => number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? 10_000;
  return {
    take(key) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((at) => time - at < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(time);
      hits.set(key, recent);
      // Bellek sınırı: en eski anahtarlar atılır.
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return true;
    },
  };
}

/** Proxy arkasında ilk istemci IP'si; yoksa "unknown". */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
