import { Hono } from "hono";
import { globalErrorHandler, notFound } from "./controllers/errorController.js";
import { parseBody } from "./middleware/bodyMiddleware.js";
import { apiLimiter } from "./middleware/rateLimitMiddleware.js";
import {
  cors,
  noStore,
  requireTrustedOrigin,
  securityHeaders,
} from "./middleware/securityMiddleware.js";
import registeredRoutes from "./routes/index.js";
import logger from "./utils/logger.js";
import redactUrl from "./utils/redactUrl.js";

/**
 * Dựng app Hono cho mọi đường /api/* (file tĩnh của frontend do Cloudflare phục vụ trước khi tới Worker).
 * Thứ tự middleware giữ như app.js của backend cũ: header bảo mật, CORS, log, đọc body, rồi tới /api/v1 với
 * no-store, giới hạn tần suất, kiểm Origin, route.
 */
const app = new Hono();

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

app.use(parseBody);

const api = new Hono();
api.use(noStore, apiLimiter, requireTrustedOrigin);
api.route("/", registeredRoutes);
app.route("/api/v1", api);

app.notFound(notFound);
app.onError(globalErrorHandler);

export default app;
