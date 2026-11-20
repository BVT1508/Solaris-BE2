import app from "./app.js";
import logger from "./utils/logger.js";
import { dryFetch, replayDb } from "./warmup/dryRun.js";
import fixture from "./warmup/fixture.js";

/**
 * Làm nóng lúc nạp module: chạy thử các request mẫu qua CẢ app (bộ định tuyến, middleware, kiểm zod, service, dựng câu
 * SQL, dựng response), để request thật đầu tiên của mỗi isolate không phải gánh chi phí lần chạy đầu của code.
 *
 * Vì sao cần: đo trên Cloudflare thật (21/11/2026), request đầu của một isolate tốn trung vị 9 ms CPU (39% vượt 10 ms),
 * trong khi cùng thao tác ở isolate đã ấm chỉ 3 tới 4 ms. Cloudflare tạo isolate mới liên tục, và gói miễn phí chỉ cho
 * 10 ms CPU mỗi request; lúc nạp module thì có hạn mức riêng (1 giây).
 *
 * Cách chạy: lúc nạp module Worker cấm I/O, hẹn giờ và sinh số ngẫu nhiên, nên các request mẫu chạy "khô"
 * (config/runtime.js): database là bản phát lại các kết quả đã ghi sẵn trong warmup/fixture.js, bộ giới hạn tần suất và
 * kết nối trực tiếp là bản giả, không ghi log, không đếm mức dùng. Không request thật nào thấy các bản giả này.
 *
 * fixture.js do `npm run warmup:record` sinh ra (scripts/record-warmup.mjs): chạy đúng các request mẫu trên một SQLite
 * tạm rồi ghi lại kết quả từng truy vấn. Sửa code làm đổi thứ tự truy vấn của một đường thì request mẫu của đường đó
 * lệch bản ghi: KHÔNG gây lỗi gì cho người dùng, chỉ là đường đó bớt được làm nóng. `npm run warmup:check` báo khi lệch;
 * chạy lại `npm run warmup:record` và commit fixture.js.
 */
export const warmupReport = { requests: 0, stale: [] };

async function warmUp() {
  for (const entry of fixture.requests) {
    const db = replayDb(entry.r);
    let status = 0;
    try {
      status = await dryFetch(app, entry, db);
    } catch {
      // Lỗi của một request mẫu không được chặn Worker khởi động.
    }
    warmupReport.requests += 1;
    if (status !== entry.s || !db.complete()) {
      warmupReport.stale.push(`${entry.m} ${entry.p}`);
    }
  }
}

try {
  await warmUp();
} catch {
  // Không bao giờ để việc làm nóng làm hỏng việc nạp module.
}

logger.debug({ requests: warmupReport.requests }, "Đã làm nóng lúc nạp module");
if (warmupReport.stale.length) {
  logger.warn(
    { stale: warmupReport.stale.length, requests: warmupReport.requests },
    "Bản ghi làm nóng đã cũ: chạy npm run warmup:record"
  );
}
