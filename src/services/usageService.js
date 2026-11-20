import { waitUntil } from "cloudflare:workers";
import env from "../config/env.js";
import { batch, first, run, sql } from "../db/d1.js";
import { pendingUsage, restoreUsage, takeUsage } from "../db/usageCounter.js";
import logger from "../utils/logger.js";
import { now } from "../utils/time.js";
import { mailEnabled, sendMail } from "./mailService.js";

/**
 * Mức dùng gói miễn phí của Cloudflare trong ngày (UTC) và cảnh báo sớm cho quản trị viên.
 *
 * Gói miễn phí không tính tiền: chạm trần thì request (hoặc mọi truy vấn D1) lỗi tới 00:00 UTC, và Cloudflare không báo
 * trước. Nên Worker tự đếm ba chỉ số có trần theo ngày: request vào Worker, dòng D1 đọc, dòng D1 ghi.
 *
 * Cách đếm, để không thêm lượt đi về nào tới D1 trên đường xử lý request:
 *   1. Mỗi request và mỗi kết quả D1 chỉ cộng vào ba con số trong bộ nhớ của isolate (db/usageCounter.js).
 *   2. Request đầu tiên sau một lần ghi hẹn một lần ghi xuống D1 sau USAGE_FLUSH_SECONDS giây (mặc định 15), chạy sau
 *      response bằng waitUntil. Mọi request tới trong khoảng đó đi chung MỘT câu UPSERT (một dòng ghi).
 *      Tải dày đặc cả ngày: nhiều nhất 5.760 dòng ghi cho mỗi isolate; thưa thì mỗi đợt request một dòng ghi.
 *
 * Số đếm là ƯỚC LƯỢNG, thường thấp hơn số thật của Cloudflare:
 *   - isolate bị tắt trong lúc chờ ghi thì mất phần chưa ghi;
 *   - chỉ đếm Worker này và database của nó. Hạn mức của Cloudflare tính theo TÀI KHOẢN: request và dòng D1 của Worker
 *     khác (bản thử), của `wrangler d1 execute`, của việc áp migration, của trang quản trị Cloudflare đều ăn chung
 *     hạn mức mà không nằm trong số này;
 *   - lô ghi bị hoàn tác (guard sai) vẫn bị Cloudflare tính dòng đọc, ở đây không đếm được.
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

/** Ngưỡng cảnh báo, phần trăm của trần, từ thấp tới cao. */
const THRESHOLDS = [
  { percent: 70, level: "warning" },
  { percent: 90, level: "critical" },
];
const LEVEL_RANK = { ok: 0, warning: 1, critical: 2 };

const today = () => new Date().toISOString().slice(0, 10);

/** 00:00 UTC kế tiếp: lúc Cloudflare đặt lại hạn mức ngày. */
const nextReset = () => {
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

const toMetric = (metric, used) => {
  const limit = metric.limit();
  return {
    key: metric.key,
    label: metric.label,
    used,
    limit,
    percent: Math.round((used / limit) * 1000) / 10,
    level: levelOf(used, limit),
  };
};

const toTotals = (row) => ({
  requests: row?.requests || 0,
  rowsRead: row?.rows_read || 0,
  rowsWritten: row?.rows_written || 0,
});

// ---------- Ghi số đếm xuống D1 ----------

// Bảng chưa có (chưa áp migration 0002): thôi thử một lúc, để không lỗi và ghi log ở mọi request.
const RETRY_AFTER_MISSING_TABLE_MS = 10 * 60 * 1000;
let pausedUntil = 0;

/**
 * Ghi phần đang nằm trong bộ nhớ xuống D1 (một câu UPSERT). Trả tổng của ngày sau khi ghi, hoặc null nếu không có gì
 * để ghi hoặc ghi không được. Không bao giờ ném lỗi: việc đếm không được làm hỏng request hay việc định kỳ.
 */
export async function flushUsage() {
  if (Date.now() < pausedUntil) return null;
  const delta = takeUsage();
  if (!delta.requests && !delta.rowsRead && !delta.rowsWritten) return null;
  try {
    const row = await first(sql`
      INSERT INTO usage_daily (day, requests, rows_read, rows_written, updated_at)
      VALUES (${today()}, ${delta.requests}, ${delta.rowsRead}, ${delta.rowsWritten}, ${now()})
      ON CONFLICT (day) DO UPDATE SET
        requests = requests + excluded.requests,
        rows_read = rows_read + excluded.rows_read,
        rows_written = rows_written + excluded.rows_written,
        updated_at = excluded.updated_at
      RETURNING requests, rows_read, rows_written`);
    return toTotals(row);
  } catch (err) {
    if (/no such table/i.test(String(err?.message))) {
      pausedUntil = Date.now() + RETRY_AFTER_MISSING_TABLE_MS;
      logger.warn(
        "Chưa có bảng usage_daily (chưa áp migration 0002): tạm không đếm mức dùng"
      );
    } else {
      // Lỗi tạm (kể cả khi D1 đã hết hạn mức ghi trong ngày): giữ số lại, lượt sau ghi tiếp.
      restoreUsage(delta);
      logger.warn({ err }, "Không ghi được số đếm mức dùng");
    }
    return null;
  }
}

let flushScheduled = false;

/**
 * Gọi ở mỗi request (điểm vào của Worker). Nếu chưa có lần ghi nào đang hẹn thì hẹn một lần, chạy sau response.
 * Chỉ đặt một cờ và một bộ hẹn giờ: không tốn CPU đáng kể, không gọi D1 trên đường của request.
 */
export function scheduleUsageFlush() {
  if (flushScheduled) return;
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

const readTotals = async (day) =>
  toTotals(
    await first(
      sql`SELECT requests, rows_read, rows_written FROM usage_daily WHERE day = ${day}`
    )
  );

/** Mức dùng hôm nay cho GET /api/v1/usage: số đã ghi xuống cộng phần isolate này chưa kịp ghi. */
export async function getUsage() {
  const day = today();
  const stored = await readTotals(day);
  const pending = pendingUsage();
  const metrics = METRICS.map((metric) =>
    toMetric(metric, stored[metric.key] + pending[metric.key])
  );
  return {
    day,
    resetAt: nextReset(),
    estimated: true,
    level: metrics.reduce(
      (top, metric) =>
        LEVEL_RANK[metric.level] > LEVEL_RANK[top] ? metric.level : top,
      "ok"
    ),
    metrics,
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

// ---------- Nội dung email ----------

const number = (value) => value.toLocaleString("vi-VN");
const percentText = (value) => `${String(value).replace(".", ",")}%`;

/** Một email cho mọi ngưỡng vừa vượt trong lượt kiểm này; chỉ số vượt cả 70% và 90% cùng lúc thì chỉ nêu ngưỡng 90%. */
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
  const critical = [...highest.values()].some((threshold) => threshold >= 90);
  const host = new URL(env.FRONTEND_URL).host;

  const subject = `[Solaris] ${critical ? "Sắp chạm trần gói miễn phí" : "Cảnh báo hạn mức gói miễn phí"}: ${top.label} đã dùng ${percentText(top.percent)}`;
  const text = [
    `Bản Solaris tại ${env.FRONTEND_URL} vừa vượt ngưỡng cảnh báo của gói miễn phí Cloudflare trong ngày ${day} (giờ UTC).`,
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
    `Hạn mức đặt lại lúc 00:00 UTC, tức 07:00 giờ Việt Nam (${nextReset()}).`,
    "Gói miễn phí không tính tiền. Nếu một chỉ số chạm 100%, hệ thống sẽ báo lỗi (mọi request, hoặc mọi thao tác với database) cho tới lúc đặt lại.",
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
