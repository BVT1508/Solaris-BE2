import { waitUntil } from "cloudflare:workers";
import env from "../config/env.js";
import { binding, dry } from "../config/runtime.js";
import { batch, first, readAll, run, sql } from "../db/d1.js";
import {
  isEmptyUsage,
  peekUsage,
  pendingUsage,
  restoreUsage,
  takeUsage,
} from "../db/usageCounter.js";
import logger from "../utils/logger.js";
import { now } from "../utils/time.js";
import { warmupReport } from "../warmup/report.js";
import { mailEnabled, sendMail } from "./mailService.js";

/**
 * Mức dùng gói miễn phí của Cloudflare trong ngày (UTC): đếm, cảnh báo sớm, tạm ngừng khi sắp hết, và số liệu cho trang
 * "Quản lý hạ tầng".
 *
 * Gói miễn phí không tính tiền: chạm trần thì request (hoặc mọi truy vấn D1) lỗi tới 00:00 UTC, và Cloudflare không báo
 * trước. Nên Worker tự đếm ba chỉ số có trần theo ngày: request vào Worker, dòng D1 đọc, dòng D1 ghi.
 *
 * Cách đếm, để không thêm lượt đi về nào tới D1 trên đường xử lý request:
 *   1. Mỗi request và mỗi kết quả D1 chỉ cộng vào vài con số trong bộ nhớ của isolate (db/usageCounter.js).
 *   2. Request đầu tiên sau một lần ghi hẹn một lần ghi xuống D1 sau USAGE_FLUSH_SECONDS giây (mặc định 15), chạy sau
 *      response bằng waitUntil. Mọi request tới trong khoảng đó đi chung MỘT lô hai câu UPSERT: dòng của ngày và dòng
 *      của giờ hiện tại (hai dòng ghi). Tải dày đặc cả ngày: nhiều nhất 11.520 dòng ghi cho mỗi isolate.
 *
 * Tạm ngừng: khi một chỉ số đạt USAGE_PAUSE_PERCENT (mặc định 97%) của trần, API trả 503 "quota_paused" cho mọi đường
 * ngoài danh sách cho phép (middleware/quotaMiddleware.js). Dừng trước 100% để quản trị viên còn vào xem được và để D1
 * không rơi vào trạng thái mọi truy vấn lỗi.
 *
 * Trạng thái lấy từ bản chụp trong bộ nhớ (`snapshot`): tổng của ngày mà isolate này biết lần gần nhất. Cloudflare chạy
 * rất nhiều isolate song song và mỗi cái chỉ thấy phần request của mình, nên bản chụp có HẠN DÙNG NGẮN
 * (USAGE_SNAPSHOT_SECONDS, mặc định 15 giây): request đầu tiên của isolate, và request đầu tiên sau khi bản chụp hết hạn,
 * đọc lại dòng của ngày (một dòng, theo khóa chính) trước khi được cho qua (`refreshUsageIfStale`). Nhờ vậy mọi isolate
 * cùng chặn sau nhiều nhất khoảng 30 giây kể từ lúc vượt ngưỡng: tối đa 15 giây để số đếm được ghi xuống, cộng tối đa
 * 15 giây để bản chụp của isolate khác hết hạn. Đã biết đang tạm ngừng thì thôi đọc lại: trạng thái đó chỉ hết khi
 * sang ngày mới, mà ngày thì tự biết từ đồng hồ.
 * Chi phí: mỗi isolate đang có lưu lượng tốn một dòng đọc mỗi 15 giây (nhiều nhất 5.760 dòng một ngày cho một isolate
 * bận suốt); tính theo request thì không bao giờ quá một dòng đọc cho mỗi request, tức dưới 100.000 dòng mỗi ngày
 * (2% hạn mức đọc) trong trường hợp xấu nhất.
 *
 * Số đếm là ƯỚC LƯỢNG, thường thấp hơn số thật của Cloudflare:
 *   - isolate bị tắt trong lúc chờ ghi thì mất phần chưa ghi;
 *   - chỉ đếm Worker này và database của nó. Hạn mức của Cloudflare tính theo TÀI KHOẢN: request và dòng D1 của Worker
 *     khác (bản thử), của `wrangler d1 execute`, của việc áp migration, của trang quản trị Cloudflare đều ăn chung
 *     hạn mức mà không nằm trong số này;
 *   - lô ghi bị hoàn tác (guard sai) vẫn bị Cloudflare tính dòng đọc, ở đây không đếm được.
 * Vì vậy còn một lớp nữa: khi chính D1 báo đã chạm trần ngày (`noteQuotaError`), hệ thống cũng chuyển sang tạm ngừng.
 */
const METRICS = [
  {
    key: "requests",
    label: "Lượt request vào Worker",
    limit: () => env.USAGE_LIMIT_REQUESTS,
  },
  {
    key: "rowsWritten",
    label: "Dòng ghi vào database D1",
    limit: () => env.USAGE_LIMIT_ROWS_WRITTEN,
  },
  {
    key: "rowsRead",
    label: "Dòng đọc từ database D1",
    limit: () => env.USAGE_LIMIT_ROWS_READ,
  },
];
const LABEL = Object.fromEntries(
  METRICS.map((metric) => [metric.key, metric.label])
);

/** Ngưỡng theo phần trăm của trần, từ thấp tới cao: cảnh báo, nguy cấp, tạm ngừng. */
const THRESHOLDS = [
  { percent: 70, level: "warning" },
  { percent: 90, level: "critical" },
  { percent: env.USAGE_PAUSE_PERCENT, level: "paused" },
].sort((a, b) => a.percent - b.percent);
const LEVEL_RANK = { ok: 0, warning: 1, critical: 2, paused: 3 };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_SHOWN = 48;
const DAYS_SHOWN = 30;
const HOURLY_KEPT_DAYS = 14;
const DAILY_KEPT_DAYS = 400;

const today = () => new Date().toISOString().slice(0, 10);
/** Khóa của giờ hiện tại trong bảng usage_hourly: 'YYYY-MM-DDTHH' (UTC). */
const hourKey = (date = new Date()) => date.toISOString().slice(0, 13);

/** 00:00 UTC kế tiếp: lúc Cloudflare đặt lại hạn mức ngày. */
export const nextReset = () => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  ).toISOString();
};

// So bằng phép nhân số nguyên để đúng ở ngay ngưỡng (không dính sai số của phép chia).
const reached = (used, limit, percent) => used * 100 >= limit * percent;

const levelOf = (used, limit) => {
  let level = "ok";
  for (const threshold of THRESHOLDS) {
    if (reached(used, limit, threshold.percent)) level = threshold.level;
  }
  return level;
};

const percentOf = (used, limit) => Math.round((used / limit) * 1000) / 10;

const toMetric = (metric, used) => {
  const limit = metric.limit();
  return {
    key: metric.key,
    label: metric.label,
    used,
    limit,
    percent: percentOf(used, limit),
    level: levelOf(used, limit),
  };
};

const topLevel = (metrics) =>
  metrics.reduce(
    (top, metric) =>
      LEVEL_RANK[metric.level] > LEVEL_RANK[top] ? metric.level : top,
    "ok"
  );

const toTotals = (row) => ({
  requests: row?.requests || 0,
  rowsRead: row?.rows_read || 0,
  rowsWritten: row?.rows_written || 0,
});

// Bảng chưa có (chưa áp migration 0002, 0003): thôi thử một lúc, để không lỗi và ghi log ở mọi request.
const RETRY_AFTER_MISSING_TABLE_MS = 10 * 60 * 1000;
let pausedUntil = 0;

const readTotals = async (day) =>
  toTotals(
    await first(
      sql`SELECT requests, rows_read, rows_written FROM usage_daily WHERE day = ${day}`
    )
  );

// ---------- Bản chụp trong bộ nhớ và trạng thái tạm ngừng ----------

/**
 * Tổng của ngày lần gần nhất isolate này biết (sau một lần ghi số đếm hoặc một lần đọc). `hard`: chính D1 đã báo chạm
 * trần ngày. Bản chụp của ngày cũ không còn giá trị: sang ngày mới (UTC) là tự hết tạm ngừng mà không cần hỏi D1.
 */
let snapshot = { day: "", totals: toTotals(null), hard: false, at: 0 };
const SNAPSHOT_TTL_MS = env.USAGE_SNAPSHOT_SECONDS * 1000;

const remember = (day, totals) => {
  snapshot = {
    day,
    totals,
    hard: snapshot.day === day && snapshot.hard,
    at: Date.now(),
  };
};

/** true khi hệ thống đang tạm ngừng vì sắp hết (hoặc đã hết) hạn mức của hôm nay. Không gọi D1. */
export function isPaused() {
  if (!snapshot.day || snapshot.day !== today()) return false;
  if (snapshot.hard) return true;
  // Cộng cả phần isolate này chưa kịp ghi xuống, để tạm ngừng có hiệu lực ngay khi chạm ngưỡng.
  const pending = peekUsage();
  for (const metric of METRICS) {
    if (
      reached(
        snapshot.totals[metric.key] + pending[metric.key],
        metric.limit(),
        env.USAGE_PAUSE_PERCENT
      )
    ) {
      return true;
    }
  }
  return false;
}

// Lời của D1 khi tài khoản gói miễn phí chạm trần ngày (danh sách lỗi ở developers.cloudflare.com/d1/observability/debug-d1/):
// "Your account has exceeded D1's free tier daily row read limit." và "... daily row write limit."
const QUOTA_ERROR = /free tier daily row (read|write) limit/i;

/** Lỗi là do D1 đã chạm trần ngày thì chuyển sang tạm ngừng tới hết ngày và trả true. */
export function noteQuotaError(err) {
  if (!QUOTA_ERROR.test(String(err?.message || ""))) return false;
  const day = today();
  snapshot = {
    day,
    totals: snapshot.day === day ? snapshot.totals : toTotals(null),
    hard: true,
    at: Date.now(),
  };
  return true;
}

/**
 * Bản chụp của isolate này chưa có hoặc đã quá hạn thì đọc lại dòng của ngày. Trả một promise để nơi gọi chờ trước khi
 * quyết định cho request qua, hoặc undefined khi bản chụp còn dùng được (đường thường gặp: không tốn gì).
 * Mỗi request tự đọc phần của mình: KHÔNG dùng chung promise giữa các request (Worker không cho request này chờ
 * I/O do request khác mở). Vài request tới cùng lúc khi bản chụp vừa hết hạn sẽ cùng đọc, mỗi cái một dòng.
 * Không bao giờ ném lỗi: đọc không được thì coi như chưa biết gì thêm và cho qua, trừ khi D1 báo đã chạm trần ngày.
 */
export function refreshUsageIfStale() {
  // Request mẫu lúc làm nóng: không đọc, không đổi bản chụp.
  if (dry()) return undefined;
  const day = today();
  if (snapshot.day === day) {
    if (snapshot.hard || Date.now() - snapshot.at < SNAPSHOT_TTL_MS) {
      return undefined;
    }
    // Đã tạm ngừng theo số đếm: tới hết ngày, không cần đọc lại.
    if (isPaused()) return undefined;
  }
  if (Date.now() < pausedUntil) return undefined;
  return readTotals(day).then(
    (totals) => remember(day, totals),
    (err) => {
      if (noteQuotaError(err)) return;
      if (/no such table/i.test(String(err?.message))) {
        pausedUntil = Date.now() + RETRY_AFTER_MISSING_TABLE_MS;
      } else {
        logger.warn({ err }, "Không đọc được mức dùng để kiểm tạm ngừng");
      }
      // Giữ những gì đang biết và tính lại hạn dùng, để không đọc lại ở mọi request khi D1 đang trục trặc.
      remember(day, snapshot.day === day ? snapshot.totals : toTotals(null));
    }
  );
}

// ---------- Ghi số đếm xuống D1 ----------

/**
 * Ghi phần đang nằm trong bộ nhớ xuống D1: một lô gồm dòng của ngày và dòng của giờ hiện tại. Trả tổng của ngày sau khi
 * ghi, hoặc null nếu không có gì để ghi hoặc ghi không được. Không bao giờ ném lỗi: việc đếm không được làm hỏng
 * request hay việc định kỳ.
 */
export async function flushUsage() {
  if (Date.now() < pausedUntil) return null;
  const delta = takeUsage();
  if (isEmptyUsage(delta)) return null;
  const day = today();
  const at = now();
  try {
    const [daily] = await batch([
      sql`
        INSERT INTO usage_daily (day, requests, rows_read, rows_written, member, guest, anonymous, paused, updated_at)
        VALUES (${day}, ${delta.requests}, ${delta.rowsRead}, ${delta.rowsWritten},
                ${delta.member}, ${delta.guest}, ${delta.anonymous}, ${delta.paused}, ${at})
        ON CONFLICT (day) DO UPDATE SET
          requests = requests + excluded.requests,
          rows_read = rows_read + excluded.rows_read,
          rows_written = rows_written + excluded.rows_written,
          member = member + excluded.member,
          guest = guest + excluded.guest,
          anonymous = anonymous + excluded.anonymous,
          paused = paused + excluded.paused,
          updated_at = excluded.updated_at
        RETURNING requests, rows_read, rows_written`,
      sql`
        INSERT INTO usage_hourly (hour, requests, rows_read, rows_written, member, guest, anonymous,
                                  status_404, status_429, status_5xx, paused, updated_at)
        VALUES (${hourKey()}, ${delta.requests}, ${delta.rowsRead}, ${delta.rowsWritten},
                ${delta.member}, ${delta.guest}, ${delta.anonymous},
                ${delta.status404}, ${delta.status429}, ${delta.status5xx}, ${delta.paused}, ${at})
        ON CONFLICT (hour) DO UPDATE SET
          requests = requests + excluded.requests,
          rows_read = rows_read + excluded.rows_read,
          rows_written = rows_written + excluded.rows_written,
          member = member + excluded.member,
          guest = guest + excluded.guest,
          anonymous = anonymous + excluded.anonymous,
          status_404 = status_404 + excluded.status_404,
          status_429 = status_429 + excluded.status_429,
          status_5xx = status_5xx + excluded.status_5xx,
          paused = paused + excluded.paused,
          updated_at = excluded.updated_at`,
    ]);
    const totals = toTotals(daily.rows[0]);
    remember(day, totals);
    return totals;
  } catch (err) {
    if (/no such table|has no column named/i.test(String(err?.message))) {
      pausedUntil = Date.now() + RETRY_AFTER_MISSING_TABLE_MS;
      logger.warn(
        "Chưa có bảng đếm mức dùng (chưa áp migration 0002, 0003, 0004): tạm không đếm"
      );
    } else {
      // Lỗi tạm: giữ số lại, lượt sau ghi tiếp. D1 báo chạm trần ngày thì chuyển sang tạm ngừng.
      restoreUsage(delta);
      if (!noteQuotaError(err)) {
        logger.warn({ err }, "Không ghi được số đếm mức dùng");
      }
    }
    return null;
  }
}

let flushScheduled = false;
// Lúc tạm ngừng, request bị chặn gần như không tốn gì: không để mỗi đợt request tốn hai dòng ghi, gom chừng này request một lần ghi.
const PAUSED_FLUSH_EVERY = 20;
let pauseFlushedDay = "";

/**
 * Gọi ở mỗi request (điểm vào của Worker). Nếu chưa có lần ghi nào đang hẹn thì hẹn một lần, chạy sau response.
 * Chỉ đặt một cờ và một bộ hẹn giờ: không tốn CPU đáng kể, không gọi D1 trên đường của request.
 */
export function scheduleUsageFlush() {
  if (flushScheduled) return;
  if (isPaused()) {
    // Lần ghi đầu tiên sau khi vào tạm ngừng thì ghi ngay (để ngưỡng tạm ngừng được ghi nhận và email đi liền);
    // các lần sau mới gom.
    const day = today();
    if (pauseFlushedDay === day) {
      if (peekUsage().requests < PAUSED_FLUSH_EVERY) return;
    } else pauseFlushedDay = day;
  }
  flushScheduled = true;
  waitUntil(
    (async () => {
      try {
        if (env.USAGE_FLUSH_SECONDS > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, env.USAGE_FLUSH_SECONDS * 1000)
          );
        }
      } finally {
        // Bỏ cờ trước khi ghi: request tới trong lúc đang ghi sẽ hẹn lần ghi kế.
        flushScheduled = false;
      }
      const totals = await flushUsage();
      if (totals) await alertIfNewlyCrossed(totals);
    })().catch((err) =>
      logger.warn({ err }, "Lỗi khi ghi số đếm mức dùng sau response")
    )
  );
}

// ---------- Đọc mức dùng ----------

/** Ba chỉ số của hôm nay từ số đã ghi (`stored`) cộng phần isolate này chưa kịp ghi. D1 đã báo chạm trần thì mức chung là paused. */
const todayView = (stored) => {
  const pending = pendingUsage();
  const metrics = METRICS.map((metric) =>
    toMetric(metric, stored[metric.key] + pending[metric.key])
  );
  return { metrics, level: snapshot.hard ? "paused" : topLevel(metrics) };
};

/** Mức dùng hôm nay cho GET /api/v1/usage. */
export async function getUsage() {
  const day = today();
  const stored = await readTotals(day);
  remember(day, stored);
  const { metrics, level } = todayView(stored);
  return { day, resetAt: nextReset(), estimated: true, level, metrics };
}

const addInto = (target, source, keys) => {
  for (const key of keys) target[key] += source[key] || 0;
};
const COUNT_KEYS = [
  "requests",
  "rowsRead",
  "rowsWritten",
  "member",
  "guest",
  "anonymous",
];
const STATUS_KEYS = ["status404", "status429", "status5xx", "paused"];

/** Các lớp bảo vệ hạn mức, để trang hạ tầng hiển thị cái nào đang bật. */
const protectionList = () => {
  const warmed =
    warmupReport.requests > 0
      ? warmupReport.requests - warmupReport.stale.length
      : 0;
  return [
    {
      key: "static_assets",
      label: "File tĩnh và đường dẫn ngoài /api không gọi Worker",
      active: true,
      detail:
        "Cloudflare tự trả giao diện và mọi đường dẫn không bắt đầu bằng /api (kể cả đường bot dò quét), không tính vào hạn mức request.",
    },
    {
      key: "robots",
      label: "robots.txt cấm thu thập",
      active: true,
      detail:
        "Bộ thu thập tử tế sẽ không quét trang; bot xấu thì bỏ qua file này.",
    },
    {
      key: "rate_limits",
      label: "Giới hạn tần suất theo IP",
      active: Boolean(binding("API_LIMITER")),
      detail:
        "Mỗi IP: 600 request API mỗi phút, 10 lần đăng nhập, 120 lần mở link chia sẻ, 60 lần ghi của khách. Giảm tải cho database; request bị chặn vẫn tính vào hạn mức request.",
    },
    {
      key: "anonymous_no_database",
      label: "Request chưa đăng nhập không đụng database",
      active: true,
      detail:
        "Không có cookie phiên và không phải đường của link chia sẻ thì bị từ chối trước khi hỏi database.",
    },
    {
      key: "pause",
      label: "Tạm ngừng khi sắp hết hạn mức",
      active: true,
      detail: `Khi một chỉ số đạt ${env.USAGE_PAUSE_PERCENT}% hạn mức ngày, API trả thông báo hết lưu lượng tới 07:00 (giờ Việt Nam); quản trị viên vẫn vào xem được.`,
    },
    {
      key: "email_alerts",
      label: "Email cảnh báo",
      active: mailEnabled(),
      detail: mailEnabled()
        ? `Gửi tới chủ hệ thống khi một chỉ số qua 70%, 90% và ${env.USAGE_PAUSE_PERCENT}%.`
        : "Chưa đặt khóa RESEND_API_KEY nên chưa gửi email; ngưỡng đã vượt vẫn được ghi nhận.",
    },
    {
      key: "warmup",
      label: "Làm nóng lúc khởi động",
      active: warmupReport.requests > 0 && warmupReport.stale.length === 0,
      detail: `${warmed}/${warmupReport.requests} request mẫu chạy trọn lúc nạp module, để request đầu của mỗi tiến trình tốn ít CPU hơn.`,
    },
    {
      key: "waf",
      label: "Chặn bot trước khi vào Worker (WAF)",
      active: false,
      detail:
        "Địa chỉ workers.dev không có tường lửa: request tới /api đã vào Worker là đã bị tính. Cần tên miền riêng trên Cloudflare để dùng luật WAF, giới hạn tần suất ở biên và Bot Fight Mode.",
    },
  ];
};

/**
 * Mọi số liệu của trang "Quản lý hạ tầng" trong MỘT lượt hỏi D1: hôm nay, 48 giờ gần nhất, 30 ngày gần nhất,
 * 20 cảnh báo mới nhất, và các lớp bảo vệ. Giờ và ngày không có dữ liệu vẫn có mặt với số 0, cũ trước mới sau.
 */
export async function getInfrastructure() {
  const current = new Date();
  const day = today();
  const hourBase = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
    current.getUTCHours()
  );
  const dayBase = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  );
  const hourSlots = Array.from({ length: HOURS_SHOWN }, (_, index) => {
    const start = new Date(hourBase - (HOURS_SHOWN - 1 - index) * HOUR_MS);
    return { key: hourKey(start), hour: start.toISOString() };
  });
  const daySlots = Array.from({ length: DAYS_SHOWN }, (_, index) =>
    new Date(dayBase - (DAYS_SHOWN - 1 - index) * DAY_MS)
      .toISOString()
      .slice(0, 10)
  );

  const [dailyRows, hourlyRows, alertRows] = await readAll([
    sql`SELECT day, requests, rows_read, rows_written, member, guest, anonymous, paused
        FROM usage_daily WHERE day >= ${daySlots[0]}`,
    sql`SELECT hour, requests, rows_read, rows_written, member, guest, anonymous, status_404, status_429, status_5xx, paused
        FROM usage_hourly WHERE hour >= ${hourSlots[0].key}`,
    sql`SELECT day, metric, threshold, emailed_at FROM usage_alerts
        ORDER BY created_at DESC, threshold DESC LIMIT 20`,
  ]);

  const pending = pendingUsage();
  const byDay = new Map(dailyRows.map((row) => [row.day, row]));
  const byHour = new Map(hourlyRows.map((row) => [row.hour, row]));
  const stored = toTotals(byDay.get(day));
  remember(day, stored);
  const { metrics, level } = todayView(stored);

  const hourly = hourSlots.map(({ key, hour }, index) => {
    const row = byHour.get(key);
    const item = {
      hour,
      requests: row?.requests || 0,
      rowsRead: row?.rows_read || 0,
      rowsWritten: row?.rows_written || 0,
      member: row?.member || 0,
      guest: row?.guest || 0,
      anonymous: row?.anonymous || 0,
      status404: row?.status_404 || 0,
      status429: row?.status_429 || 0,
      status5xx: row?.status_5xx || 0,
      // Request bị từ chối vì tạm ngừng (503 "quota_paused"): đếm riêng, không nằm trong status5xx.
      paused: row?.paused || 0,
    };
    // Giờ hiện tại (phần tử cuối): cộng phần isolate này chưa kịp ghi.
    if (index === HOURS_SHOWN - 1) {
      addInto(item, pending, COUNT_KEYS);
      addInto(item, pending, STATUS_KEYS);
    }
    return item;
  });

  const daily = daySlots.map((slot, index) => {
    const row = byDay.get(slot);
    const item = {
      day: slot,
      requests: row?.requests || 0,
      rowsRead: row?.rows_read || 0,
      rowsWritten: row?.rows_written || 0,
      member: row?.member || 0,
      guest: row?.guest || 0,
      anonymous: row?.anonymous || 0,
      paused: row?.paused || 0,
    };
    if (index === DAYS_SHOWN - 1) {
      addInto(item, pending, COUNT_KEYS);
      addInto(item, pending, ["paused"]);
    }
    // Mức cao nhất trong ba chỉ số của ngày đó, tính theo trần hiện tại.
    item.peakPercent = Math.max(
      ...METRICS.map((metric) => percentOf(item[metric.key], metric.limit()))
    );
    return item;
  });

  const url = new URL(env.FRONTEND_URL);
  return {
    plan: "Workers Free",
    worker: { name: url.hostname.split(".")[0], url: env.FRONTEND_URL },
    day,
    resetAt: nextReset(),
    estimated: true,
    level,
    pausePercent: env.USAGE_PAUSE_PERCENT,
    metrics,
    hourly,
    daily,
    alerts: alertRows.map((row) => ({
      day: row.day,
      metric: row.metric,
      label: LABEL[row.metric] || row.metric,
      threshold: row.threshold,
      emailedAt: row.emailed_at,
    })),
    protection: protectionList(),
  };
}

// ---------- Cảnh báo khi vượt ngưỡng ----------

/**
 * Ghi nhận các ngưỡng đã vượt trong ngày và gửi email cho những ngưỡng chưa được báo.
 * Mỗi (ngày, chỉ số, ngưỡng) là một dòng của usage_alerts (khóa chính), nên mỗi ngưỡng chỉ được báo một lần:
 * câu UPDATE nhận phần gửi (đặt emailed_at) chỉ trả những dòng chưa ai nhận, kể cả khi hai isolate cùng chạy.
 * Gửi lỗi thì trả dòng về trạng thái chưa gửi, lượt kiểm sau (mỗi giờ) thử lại. Chưa có khóa email thì chỉ ghi nhận.
 */
async function processAlerts(day, totals) {
  const crossed = [];
  for (const metric of METRICS) {
    for (const threshold of THRESHOLDS) {
      if (reached(totals[metric.key], metric.limit(), threshold.percent)) {
        crossed.push({ metric, threshold: threshold.percent });
      }
    }
  }
  if (!crossed.length) return { crossed: 0 };

  const stamp = now();
  const record = sql`
    INSERT INTO usage_alerts (day, metric, threshold, used, limit_value, created_at)
    VALUES ${sql.join(
      crossed.map(
        ({ metric, threshold }) =>
          sql`(${day}, ${metric.key}, ${threshold}, ${totals[metric.key]}, ${metric.limit()}, ${stamp})`
      )
    )}
    ON CONFLICT (day, metric, threshold) DO NOTHING`;

  if (!mailEnabled()) {
    const { changes } = await run(record);
    return { crossed: crossed.length, recorded: changes, emailed: 0 };
  }

  const [recorded, claimed] = await batch([
    record,
    sql`UPDATE usage_alerts SET emailed_at = ${stamp}, email_error = NULL
        WHERE day = ${day} AND emailed_at IS NULL RETURNING metric, threshold`,
  ]);
  const result = {
    crossed: crossed.length,
    recorded: recorded.changes,
    emailed: 0,
  };
  if (!claimed.rows.length) return result;

  try {
    await sendMail(buildAlertMail(day, totals, claimed.rows));
    result.emailed = claimed.rows.length;
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500);
    await run(
      sql`UPDATE usage_alerts SET emailed_at = NULL, email_error = ${message}
          WHERE day = ${day} AND emailed_at = ${stamp}`
    );
    logger.warn({ err }, "Không gửi được email cảnh báo hạn mức");
    result.emailError = message;
  }
  return result;
}

// Ngưỡng mà isolate này đã đưa đi kiểm trong ngày: để lần ghi số đếm nào cũng không phải hỏi lại bảng usage_alerts.
let seenDay = "";
const seen = new Set();

/** Sau mỗi lần ghi số đếm: nếu tổng mới chạm một ngưỡng mà isolate này chưa đưa đi kiểm thì kiểm ngay (không chờ lượt mỗi giờ). */
async function alertIfNewlyCrossed(totals) {
  const day = today();
  if (seenDay !== day) {
    seenDay = day;
    seen.clear();
  }
  let fresh = false;
  for (const metric of METRICS) {
    for (const threshold of THRESHOLDS) {
      const key = `${metric.key}:${threshold.percent}`;
      if (
        !seen.has(key) &&
        reached(totals[metric.key], metric.limit(), threshold.percent)
      ) {
        seen.add(key);
        fresh = true;
      }
    }
  }
  if (fresh) await processAlerts(day, totals);
}

/** Việc định kỳ mỗi giờ: ghi phần đang chờ, đọc tổng của ngày, báo ngưỡng mới vượt và thử lại email gửi lỗi. */
export async function checkUsage() {
  await flushUsage();
  const day = today();
  const totals = await readTotals(day);
  remember(day, totals);
  const alerts = await processAlerts(day, totals);
  return {
    day,
    percent: Object.fromEntries(
      METRICS.map((metric) => [
        metric.key,
        toMetric(metric, totals[metric.key]).percent,
      ])
    ),
    ...alerts,
  };
}

/** Việc định kỳ: bỏ số đếm theo giờ cũ hơn 14 ngày, số đếm theo ngày và cảnh báo cũ hơn 400 ngày. */
export async function purgeOldUsage() {
  const hourCutoff = hourKey(new Date(Date.now() - HOURLY_KEPT_DAYS * DAY_MS));
  const dayCutoff = new Date(Date.now() - DAILY_KEPT_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const [hourly, daily, alerts] = await batch([
    sql`DELETE FROM usage_hourly WHERE hour < ${hourCutoff}`,
    sql`DELETE FROM usage_daily WHERE day < ${dayCutoff}`,
    sql`DELETE FROM usage_alerts WHERE day < ${dayCutoff}`,
  ]);
  return {
    hourly: hourly.changes,
    daily: daily.changes,
    alerts: alerts.changes,
  };
}

// ---------- Nội dung email ----------

const number = (value) => value.toLocaleString("vi-VN");
const percentText = (value) => `${String(value).replace(".", ",")}%`;

/** Một email cho mọi ngưỡng vừa vượt trong lượt kiểm này; chỉ số vượt nhiều ngưỡng cùng lúc thì chỉ nêu ngưỡng cao nhất. */
function buildAlertMail(day, totals, claimedRows) {
  const highest = new Map();
  for (const row of claimedRows) {
    highest.set(
      row.metric,
      Math.max(row.threshold, highest.get(row.metric) || 0)
    );
  }
  const view = METRICS.map((metric) => toMetric(metric, totals[metric.key]));
  const crossed = view
    .filter((metric) => highest.has(metric.key))
    .sort((a, b) => b.percent - a.percent);
  const top = crossed[0];
  const worst = Math.max(...highest.values());
  const paused = worst >= env.USAGE_PAUSE_PERCENT;
  const host = new URL(env.FRONTEND_URL).host;

  let headline = "Cảnh báo hạn mức gói miễn phí";
  if (paused) headline = "Hệ thống đã tạm ngừng vì sắp hết hạn mức";
  else if (worst >= 90) headline = "Sắp chạm trần gói miễn phí";

  // Bản không phải bản team dùng (ENVIRONMENT_LABEL, ví dụ "bản thử"): ghi rõ ở tiêu đề và dòng đầu, để không lẫn với thư thật.
  const label = env.ENVIRONMENT_LABEL;
  const subject = `[Solaris${label ? `, ${label}` : ""}] ${headline}: ${top.label} đã dùng ${percentText(top.percent)}`;
  const text = [
    ...(label
      ? [`Đây là thư từ ${label}, không phải bản team đang dùng.`, ""]
      : []),
    paused
      ? `Bản Solaris tại ${env.FRONTEND_URL} đã TẠM NGỪNG phục vụ: một chỉ số đã đạt ${env.USAGE_PAUSE_PERCENT}% hạn mức gói miễn phí Cloudflare của ngày ${day} (giờ UTC).`
      : `Bản Solaris tại ${env.FRONTEND_URL} vừa vượt ngưỡng cảnh báo của gói miễn phí Cloudflare trong ngày ${day} (giờ UTC).`,
    ...(paused
      ? [
          "Người dùng và khách đang thấy thông báo hết lưu lượng. Quản trị viên vẫn đăng nhập và xem trang hạ tầng được.",
        ]
      : []),
    "",
    "Vừa vượt ngưỡng:",
    ...crossed.map(
      (metric) =>
        `- ${metric.label}: đã qua ${highest.get(metric.key)}% của hạn mức ngày`
    ),
    "",
    "Mức dùng hiện tại (số ước lượng do hệ thống tự đếm, có thể thấp hơn số của Cloudflare):",
    ...view.map(
      (metric) =>
        `- ${metric.label}: ${number(metric.used)} / ${number(metric.limit)} (${percentText(metric.percent)})`
    ),
    "",
    `Hạn mức đặt lại lúc 00:00 UTC, tức 07:00 giờ Việt Nam (${nextReset()}); hệ thống tự hoạt động lại lúc đó.`,
    `Gói miễn phí không tính tiền. Hệ thống tự tạm ngừng khi một chỉ số đạt ${env.USAGE_PAUSE_PERCENT}% để không rơi vào trạng thái mọi thao tác đều lỗi.`,
    `Xem mức dùng bất cứ lúc nào: đăng nhập bằng tài khoản quản trị tại ${env.FRONTEND_URL}.`,
  ].join("\n");

  return {
    to: env.ALERT_EMAIL_TO || env.OWNER_EMAIL,
    subject,
    text,
    idempotencyKey: `solaris-usage:${host}:${day}:${claimedRows
      .map((row) => `${row.metric}-${row.threshold}`)
      .sort()
      .join(",")}`,
  };
}
