import { describe, expect, it } from "vitest";

import {
  BACKUP_INTERVALS,
  formatBytes,
  formatDuration,
  isBackupDue,
  manualCooldownUntil,
  nextAutoBackupAt,
  parseBackupSettingsPatch,
  selectRetentionDeletes,
  type RetentionCandidate,
} from "./shared";

const at = (iso: string) => new Date(iso);

describe("periyotlar", () => {
  it("K. yalnız 15dk/30dk/1s/3s/6s/12s/Günlük/Haftalık; 15 dakikanın altı yok", () => {
    expect(BACKUP_INTERVALS.map((option) => [option.minutes, option.label])).toEqual([
      [15, "15 dakika"], [30, "30 dakika"], [60, "1 saat"], [180, "3 saat"], [360, "6 saat"], [720, "12 saat"], [1440, "Günlük"], [10080, "Haftalık"],
    ]);
    expect(Math.min(...BACKUP_INTERVALS.map((option) => option.minutes))).toBe(15);
  });

  it.each([
    [15, "2026-10-14T14:45:00.000Z"],
    [30, "2026-10-14T15:00:00.000Z"],
    [60, "2026-10-14T15:30:00.000Z"],
    [180, "2026-10-14T17:30:00.000Z"],
    [360, "2026-10-14T20:30:00.000Z"],
    [720, "2026-10-15T02:30:00.000Z"],
    [1440, "2026-10-15T14:30:00.000Z"],
    [10080, "2026-10-21T14:30:00.000Z"],
  ])("K. %i dakika → sonraki yedek %s", (minutes, expected) => {
    const last = at("2026-10-14T14:30:00.000Z");
    const settings = { autoEnabled: true, intervalMinutes: minutes };
    expect(nextAutoBackupAt(settings, last, at("2026-10-14T14:31:00.000Z"))?.toISOString()).toBe(expected);
    const due = new Date(Date.parse(expected));
    expect(isBackupDue(settings, last, due)).toBe(true);
    // Cron birkaç saniye erken tetiklese de (2 dk pay) kaçırılmaz.
    expect(isBackupDue(settings, last, new Date(due.getTime() - 90_000))).toBe(true);
    expect(isBackupDue(settings, last, new Date(due.getTime() - 3 * 60_000))).toBe(false);
  });

  it("I/J. hiç yedek yoksa hemen; kapalıysa asla", () => {
    const now = at("2026-10-14T14:30:00.000Z");
    expect(isBackupDue({ autoEnabled: true, intervalMinutes: 1440 }, null, now)).toBe(true);
    expect(nextAutoBackupAt({ autoEnabled: true, intervalMinutes: 1440 }, null, now)).toEqual(now);
    expect(isBackupDue({ autoEnabled: false, intervalMinutes: 15 }, null, now)).toBe(false);
    expect(nextAutoBackupAt({ autoEnabled: false, intervalMinutes: 15 }, null, now)).toBeNull();
  });

  it("H. cooldown 5 dakika", () => {
    const last = at("2026-10-14T14:30:00.000Z");
    expect(manualCooldownUntil(last, at("2026-10-14T14:31:00.000Z"))?.toISOString()).toBe("2026-10-14T14:35:00.000Z");
    expect(manualCooldownUntil(last, at("2026-10-14T14:35:00.000Z"))).toBeNull();
    expect(manualCooldownUntil(null, last)).toBeNull();
  });

  it("ayar doğrulaması: 1/2/3/5 dakika reddedilir, saklama sınırları", () => {
    for (const minutes of [1, 2, 3, 5, 10, 45, "15"]) expect(parseBackupSettingsPatch({ intervalMinutes: minutes }).ok).toBe(false);
    expect(parseBackupSettingsPatch({ intervalMinutes: 15, autoEnabled: false })).toEqual({ ok: true, value: { intervalMinutes: 15, autoEnabled: false } });
    expect(parseBackupSettingsPatch({ keepLast: 0 }).ok).toBe(false);
    expect(parseBackupSettingsPatch({ keepDailyDays: 7, keepWeeklyWeeks: 4, keepPreRestoreDays: 14 }).ok).toBe(true);
    expect(parseBackupSettingsPatch({})).toEqual({ ok: false, error: "Değiştirilecek ayar yok." });
    expect(parseBackupSettingsPatch({ autoEnabled: "evet" }).ok).toBe(false);
  });
});

describe("L. saklama politikası", () => {
  const policy = { keepLast: 3, keepDailyDays: 7, keepWeeklyWeeks: 4, keepPreRestoreDays: 14 };
  const now = at("2026-10-14T12:00:00.000Z");
  const backup = (id: string, takenAt: string, kind: RetentionCandidate["kind"] = "scheduled"): RetentionCandidate => ({ id, kind, takenAt });

  it("son N + günlük + haftalık tutulur, gerisi silinir", () => {
    const list = [
      backup("today-3", "2026-10-14T11:00:00.000Z"),
      backup("today-2", "2026-10-14T10:00:00.000Z"),
      backup("today-1", "2026-10-14T09:00:00.000Z"),
      backup("today-0", "2026-10-14T08:00:00.000Z"),
      backup("yesterday-late", "2026-10-13T20:00:00.000Z"),
      backup("yesterday-early", "2026-10-13T06:00:00.000Z"),
      backup("day-5", "2026-10-09T10:00:00.000Z"),
      backup("week-3a", "2026-09-24T10:00:00.000Z"),
      backup("week-3b", "2026-09-23T10:00:00.000Z"),
      backup("old", "2026-08-01T10:00:00.000Z"),
    ];
    expect(selectRetentionDeletes(list, policy, now).sort()).toEqual(["old", "today-0", "week-3b", "yesterday-early"].sort());
  });

  it("geri yükleme öncesi yedek: 14 gün tutulur, en yenisi her zaman; korunanlar silinmez", () => {
    const list = [
      backup("pre-new", "2026-09-01T10:00:00.000Z", "pre_restore"),
      backup("pre-old", "2026-08-01T10:00:00.000Z", "pre_restore"),
      backup("pre-recent", "2026-10-13T10:00:00.000Z", "pre_restore"),
      backup("manual-old", "2026-07-01T10:00:00.000Z", "manual"),
    ];
    const deletes = selectRetentionDeletes(list, { ...policy, keepLast: 1 }, now, new Set(["manual-old"]));
    expect(deletes.sort()).toEqual(["pre-new", "pre-old"].sort());
    expect(selectRetentionDeletes([backup("only-pre", "2025-01-01T00:00:00.000Z", "pre_restore")], policy, now)).toEqual([]);
  });

  it("en az bir normal yedek her zaman kalır", () => {
    expect(selectRetentionDeletes([backup("x", "2020-01-01T00:00:00.000Z")], { keepLast: 1, keepDailyDays: 0, keepWeeklyWeeks: 0, keepPreRestoreDays: 1 }, now)).toEqual([]);
  });
});

describe("biçimlendirme", () => {
  it("boyut ve süre", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
    expect(formatBytes(null)).toBe("—");
    expect(formatDuration(42_000)).toBe("42 sn");
    expect(formatDuration(72_000)).toBe("1 dk 12 sn");
    expect(formatDuration(3_660_000)).toBe("1 sa 1 dk");
  });
});
