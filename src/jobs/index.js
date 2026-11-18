import env from "../config/env.js";
import { run, sql } from "../db/d1.js";
import { ensureOwner } from "../services/authService.js";
import logger from "../utils/logger.js";
import { toSearchText } from "../utils/searchText.js";
import { now } from "../utils/time.js";
import * as maintenanceJobs from "./maintenanceJobs.js";
import * as storageJobs from "./storageJobs.js";

/**
 * Việc định kỳ (Cron Triggers, khai ở "triggers" trong wrangler.jsonc), thay cho setInterval của backend cũ.
 * Mỗi biểu thức cron ứng với một nhóm việc; mỗi lượt chạy cũng bị giới hạn 10 ms CPU và 50 lời gọi ra ngoài,
 * nên mỗi việc chỉ xử lý một lô nhỏ, còn lại để lượt sau.
 *
 * Các gói việc thêm việc của mình vào storageJobs.js và maintenanceJobs.js, không sửa file này.
 * Thử trên máy dev (server đang chạy): curl "http://127.0.0.1:4000/cdn-cgi/local/scheduled?cron=23+*+*+*+*"
 * Chạy riêng một việc trên máy dev: cron=job:<từ khóa trong tên việc>, xem selectJobs bên dưới.
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
    sql`DELETE FROM rate_counters WHERE window_start < ${Date.now() - 24 * 60 * 60 * 1000}`
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
    // Backend cũ khôi phục chủ hệ thống mỗi lần server khởi động; Worker không có lúc khởi động nên làm ở đây và ở các đường đăng nhập.
    ["bảo đảm chủ hệ thống", async () => (await ensureOwner(), "xong")],
    ...storageJobs.hourlyJobs,
  ],
  [SIX_HOURLY]: [
    ...storageJobs.sixHourlyJobs,
    ...maintenanceJobs.sixHourlyJobs,
  ],
};

/**
 * Việc được chọn cho một lượt chạy. Bình thường là cả nhóm của biểu thức cron.
 *
 * Riêng máy dev (ENVIRONMENT=development): truyền cron dạng "job:<từ khóa>" để chạy ĐÚNG MỘT việc, là việc có tên chứa
 * từ khóa (không phân biệt dấu và hoa thường). Dùng khi thử một việc mà không muốn kéo theo việc khác cùng nhóm
 * (ví dụ thử dọn bản cũ mà không dọn file tạm trên kho thật):
 *   curl "http://127.0.0.1:4000/cdn-cgi/local/scheduled?cron=job:ban+cu"
 * Từ khóa không khớp hoặc khớp nhiều việc thì không chạy gì và ghi ra danh sách tên việc. Bản deploy bỏ qua dạng này.
 */
function selectJobs(cron) {
  if (!cron.startsWith("job:")) return JOBS[cron] || [];
  if (!env.IS_DEV) return [];
  const all = Object.values(JOBS).flat();
  const keyword = toSearchText(cron.slice(4).trim());
  const matched = keyword
    ? all.filter(([label]) => toSearchText(label).includes(keyword))
    : [];
  if (matched.length !== 1) {
    logger.warn(
      { keyword, jobs: all.map(([label]) => label) },
      "Từ khóa phải khớp đúng một việc định kỳ"
    );
    return [];
  }
  return matched;
}

/** Một việc lỗi không chặn việc khác; lỗi chỉ ghi log. */
export async function runScheduled(cron) {
  for (const [label, job] of selectJobs(String(cron || ""))) {
    try {
      const result = await job();
      logger.info({ job: label, result }, "Đã chạy việc định kỳ");
    } catch (err) {
      logger.error({ err, job: label }, "Việc định kỳ bị lỗi");
    }
  }
}
