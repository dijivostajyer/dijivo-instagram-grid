import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Arka plan hatırlatma kurulumunun production dosyalarını doğrudan test eder:
 *
 *  - `202610020004_schedule_reminder_dispatch.sql`: pg_cron → pg_net →
 *    Edge Function çağrısı Vault üzerinden mi, düz metin secret / var olmayan
 *    `app.settings.*` GUC'ı kullanılıyor mu?
 *  - `supabase/functions/reminder-dispatch/index.ts`: ham SQL'i PostgREST
 *    body olarak mı gönderiyor (REGRESyon — PostgREST ham SQL çalıştırmaz),
 *    yoksa RPC'yi mi çağırıyor? Handler-side auth var mı?
 *
 * Dosya metinleri okunarak yazılır; bir ifade unutulduğunda test kırılır.
 */

const cronMigrationSql = readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/202610020004_schedule_reminder_dispatch.sql",
  ),
  "utf8",
);

/** SQL yorum satırlarını atlar (açıklama metni testleri tetiklemesin). */
function stripSqlComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const cronMigrationCode = stripSqlComments(cronMigrationSql);

const workerSource = readFileSync(
  path.resolve(__dirname, "../../supabase/functions/reminder-dispatch/index.ts"),
  "utf8",
);

const runbook = readFileSync(path.resolve(__dirname, "../../SUPABASE-KURULUM.md"), "utf8");

const calendarMigrationSql = readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/202610020003_create_calendar_tables.sql",
  ),
  "utf8",
);

describe("dosya bütünlüğü", () => {
  it("diff/çakışma işaretleri dosyalara sızmamış", () => {
    // Düzenleme araçlarıyla yanlışlıkla satır başına `+` ya da merge
    // çakışması bulaşması SQL'i production'da syntax hatası yapar;
    // üç kaynak dosya da temiz olmalı.
    const sources: Array<[string, string]> = [
      ["0003", calendarMigrationSql],
      ["0004", cronMigrationSql],
      ["edge worker", workerSource],
    ];
    for (const [name, source] of sources) {
      const strayPlus = source
        .split(/\r?\n/)
        .filter((line) => line.startsWith("+"));
      expect(strayPlus, `${name}: satır başına + işaretleri`).toEqual([]);
      expect(source, `${name}: merge çakışması`).not.toContain("<<<<<<<");
      expect(source, `${name}: merge çakışması`).not.toContain(">>>>>>>");
    }
  });
});

describe("pg_cron zamanlaması (202610020004)", () => {
  it("var olmayan app.settings.* GUC'larını kullanmaz", () => {
    // production Supabase'te current_setting('app.settings.*') tanımlı değil;
    // eski sürüm bu yüzden NULL header'lı kırık job kuruyordu. Yalnızca
    // kod (yorumlar hariç) taranır: dosyanın başlığı bu hatayı neden
    // kullanmadığını açıklar.
    expect(cronMigrationCode).not.toContain("app.settings.");
    expect(cronMigrationCode).not.toContain("current_setting");
  });

  it("secret'ı düz metin gömmez — URL ve key Vault'tan okunur", () => {
    expect(cronMigrationCode).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
    expect(cronMigrationCode).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT literal
    expect(cronMigrationSql).toContain("vault.decrypted_secrets");
    expect(cronMigrationSql).toContain("dijivo_project_url");
    expect(cronMigrationSql).toContain("dijivo_service_key");
    // Anahtar yalnızca Vault lookup'ıyla header'a girer:
    expect(cronMigrationSql).toContain(
      "'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'dijivo_service_key')",
    );
  });

  it("pg_net net.http_post ile çağırır ve cron job kaydı idempotenttir", () => {
    expect(cronMigrationSql).toContain("net.http_post");
    expect(cronMigrationSql).toContain("cron.schedule");
    expect(cronMigrationSql).toContain("'reminder-dispatch'");
    expect(cronMigrationSql).toContain("'* * * * *'");
    // Yeniden çalıştırmada eski job temizlenir:
    expect(cronMigrationSql).toContain("cron.unschedule");
  });

  it("Edge Function path'i her koşulda doğrudur: /functions/v1/reminder-dispatch", () => {
    expect(cronMigrationSql).toContain(
      "|| '/functions/v1/reminder-dispatch'",
    );
    // URL vault'tan farklı formatlar gelebilir → sondaki / temizlenir:
    expect(cronMigrationSql).toContain("rtrim(");
  });

  it("uzantılar idempotent açılır (pg_cron, pg_net) ve Vault extension ATMAZ", () => {
    expect(cronMigrationSql).toContain("create extension if not exists pg_cron");
    expect(cronMigrationSql).toContain("create extension if not exists pg_net");
    // Hosted Supabase'de `create extension vault` .control dosyası yoktur
    // ve `ERROR: extension "vault" is not available` verir. Vault hizmet
    // olarak gelir; migration içinden extension açmaya KALDIRILMIŞ olmalı.
    // Yorumlarda geçen açıklama metni ("create extension vault") testi
    // tetiklemesin diye yalnızca kod kısmı (yorumlar atlanmış) taranır.
    expect(cronMigrationCode).not.toMatch(/create extension\b[^;]*vault/i);
    // Bunun yerine Vault erişimi precondition'i ile korunur:
    expect(cronMigrationSql).toContain("to_regclass('vault.decrypted_secrets')");
    expect(cronMigrationSql).toContain("vault.decrypted_secrets");
    // Eksik secret hala açık hatayla durdurur:
    expect(cronMigrationSql).toContain("raise exception");
    expect(cronMigrationSql).toContain("vault.create_secret");
  });
});

describe("reminder-dispatch Edge Function", () => {
  it("ham SQL'i PostgREST body olarak GÖNDERMEZ (regresyon koruması)", () => {
    // PostgREST ham SQL çalıştırmaz: POST /rest/v1/reminder_deliveries
    // gövdesine SQL metni koymak production'da delivery_insert_failed
    // (400) veriyordu.
    expect(workerSource).not.toContain("insert into public.reminder_deliveries");
    expect(workerSource).not.toContain("DUE_REMINDER_INSERT_SQL");
    expect(workerSource).not.toMatch(
      /postgrest\(\s*["'`]reminder_deliveries["'`]/,
    );
  });

  it("PostgREST RPC'yi çağırır: rpc/dispatch_due_reminders + p_limit 200", () => {
    expect(workerSource).toContain("rpc/dispatch_due_reminders");
    expect(workerSource).toContain("p_limit");
    expect(workerSource).toContain('method: "POST"');
    // RPC hatası ayrık ele alınır (500 dispatch_rpc_failed):
    expect(workerSource).toContain('"dispatch_rpc_failed"');
  });

  it("gelen çağrıyı handler-side apikey ile doğrular (--no-verify-jwt)", () => {
    expect(workerSource).toContain("apikey");
    expect(workerSource).toContain("SERVICE_ROLE_KEY");
    expect(workerSource).toContain('"unauthorized"');
    // 401 yolu gerçekten return edilmiş olmalı:
    expect(workerSource).toMatch(/jsonError\(401,\s*"unauthorized"\)/);
  });

  it("yeni dönen satırlara push gönderir ve ölü abonelikleri temizler", () => {
    expect(workerSource).toContain('row.channel === "browser_push"');
    expect(workerSource).toContain("webpush.sendNotification");
    expect(workerSource).toContain("status === 404 || status === 410");
    expect(workerSource).toContain("push_subscriptions?id=eq.");
    expect(workerSource).toContain("[reminder-dispatch] push_failed");
  });
});

describe("SUPABASE-KURULUM.md koşu kitabı", () => {
  it("--no-verify-jwt deploy ve Vault secret adımlarını belgeler", () => {
    expect(runbook).toContain("--no-verify-jwt");
    expect(runbook).toContain("vault.create_secret");
    expect(runbook).toContain("dijivo_service_key");
  });

  it("RPC adını ve SQL Editor sırasını belgeler", () => {
    expect(runbook).toContain("dispatch_due_reminders");
    expect(runbook).toContain("202610020004_schedule_reminder_dispatch.sql");
  });
});
