import { run, sql } from "../db/d1.js";
import logger from "../utils/logger.js";
import { fromNow, now } from "../utils/time.js";

/**
 * Việc định kỳ (Cron Triggers, khai ở "triggers" trong wrangler.jsonc), thay cho setInterval của backend cũ.
 * Mỗi biểu thức cron ứng với một nhóm việc; mỗi lượt chạy cũng bị giới hạn 10 ms CPU và 50 lời gọi ra ngoài,
 * nên mỗi việc chỉ xử lý một lô nhỏ, còn lại để lượt sau.
 * Thử trên máy dev: `npx wrangler dev --test-scheduled` rồi mở /cdn-cgi/handler/scheduled?cron=23+*+*+*+*
 */
const HOURLY = "23 * * * *";
const SIX_HOURLY = "41 */6 * * *";

/** Dòng hết hạn mà MongoDB cũ tự xóa bằng TTL index. */
async function purgeExpiredRows() {
  const sessions = await run(
    sql`DELETE FROM sessions WHERE expires_at < ${now()}`
  );
  const states = await run(
    sql`DELETE FROM oauth_states WHERE expires_at < ${now()}`
  );
  // Bộ đếm hạn mức: cửa sổ dài nhất là 10 phút, giữ dư một ngày.
  const counters = await run(
    sql`DELETE FROM rate_counters WHERE window_start < ${Date.parse(fromNow(-24 * 60 * 60 * 1000))}`
  );
  return {
    sessions: sessions.changes,
    oauthStates: states.changes,
    rateCounters: counters.changes,
  };
}

const JOBS = {
  [HOURLY]: [
    ["dọn dòng hết hạn", purgeExpiredRows],
    // Gói việc file thêm ở đây: dọn thùng rác kho file (storageService.emptyTrash).
  ],
  [SIX_HOURLY]: [
    // Gói việc file thêm ở đây: dọn file tạm quá 1 ngày trên kho (storageService.purgeStalePending).
    // Gói việc vòng review thêm ở đây: dọn bản cũ của đơn đã bàn giao quá 30 ngày (maintenanceService.purgeDeliveredVersions).
  ],
};

/** Một việc lỗi không chặn việc khác; lỗi chỉ ghi log. */
export async function runScheduled(cron) {
  for (const [label, job] of JOBS[cron] || []) {
    try {
      const result = await job();
      logger.info({ job: label, result }, "Đã chạy việc định kỳ");
    } catch (err) {
      logger.error({ err, job: label }, "Việc định kỳ bị lỗi");
    }
  }
}
