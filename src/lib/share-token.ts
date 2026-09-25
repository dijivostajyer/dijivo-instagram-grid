const SHARE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomTokenUuid(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.randomUUID !== "function") {
    throw new Error("Güvenli token üretimi bu ortamda kullanılamıyor.");
  }
  return cryptoApi.randomUUID();
}

/** Tahmin edilemeyen paylaşım kimliği üretir. */
export function generateShareToken(
  createUuid: () => string = randomTokenUuid,
): string {
  const token = createUuid();
  if (!isValidShareToken(token)) {
    throw new Error("Geçersiz paylaşım tokenı üretildi.");
  }
  return token;
}

/** Route parametresi olarak güvenle işlenebilecek UUID biçimini doğrular. */
export function isValidShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}
