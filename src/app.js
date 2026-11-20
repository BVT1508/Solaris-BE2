import { Hono } from "hono";
import { globalErrorHandler, notFound } from "./controllers/errorController.js";
import { parseBody } from "./middleware/bodyMiddleware.js";
import { pauseGate } from "./middleware/quotaMiddleware.js";
import { serveFrontend } from "./middleware/frontendMiddleware.js";
import { apiLimiter } from "./middleware/rateLimitMiddleware.js";
import {
  cors,
  noStore,
  requireTrustedOrigin,
  securityHeaders,
} from "./middleware/securityMiddleware.js";
import { connectRealtime } from "./realtime/connect.js";
import registeredRoutes from "./routes/index.js";
import logger from "./utils/logger.js";
import redactUrl from "./utils/redactUrl.js";

/**
 * Dựng app Hono cho mọi request vào Worker: /api/*, và các đường dẫn không khớp file tĩnh nào
 * (file tĩnh có thật của frontend do Cloudflare phục vụ trước khi tới Worker).
 * Thứ tự middleware của API giữ như app.js của backend cũ: header bảo mật, CORS, log, đọc body, rồi tới /api/v1 với
 * no-store, giới hạn tần suất, kiểm Origin, route.
 *
 * Chỉ MỘT app (một bảng định tuyến): Hono chạy các handler khớp đường dẫn theo thứ tự đăng ký, nên hai thứ phải đứng
 * ngoài chuỗi middleware của API được đăng ký trước chuỗi đó và trả lời luôn, không gọi next.
 */
const app = new Hono();

// Kết nối trực tiếp: response nâng cấp WebSocket không cho sửa header, nên không được đi qua middleware nào.
app.get("/api/v1/realtime", connectRealtime);

// Đường dẫn của ứng dụng frontend (không phải /api, không có đuôi file) trả index.html; không mang header bảo mật của API.
app.use(async (c, next) => serveFrontend(c) || next());

app.use(securityHeaders);
app.use(cors);

// Log mỗi request một dòng: chỉ phương thức, đường dẫn (token của link đã che), mã trả về, thời gian. Không ghi header hay body.
app.use(async (c, next) => {
  const startedAt = Date.now();
  await next();
  const url = new URL(c.req.url);
  logger.info(
    {
      method: c.req.method,
      url: redactUrl(url.pathname + url.search),
      status: c.res.status,
      ms: Date.now() - startedAt,
    },
    "request"
  );
});

// Sắp hết hạn mức gói miễn phí của hôm nay: trả 503 "quota_paused" ngay, trước khi đọc body hay đụng database.
app.use("/api/v1/*", pauseGate);

app.use(parseBody);

const api = new Hono();
api.use(noStore, apiLimiter, requireTrustedOrigin);
api.route("/", registeredRoutes);
app.route("/api/v1", api);

app.notFound(notFound);
app.onError(globalErrorHandler);

// Dựng sẵn bảng định tuyến ngay lúc nạp module. Hono mặc định để tới request đầu tiên mới dựng (vài mili giây CPU với
// khoảng 80 route), và request đầu của mỗi isolate mới sẽ gánh phần đó trong khi gói miễn phí chỉ cho 10 ms CPU mỗi request.
// Lúc nạp module có hạn mức riêng (thời gian khởi động), không tính vào request.
app.router.match("GET", "/");

export default app;
