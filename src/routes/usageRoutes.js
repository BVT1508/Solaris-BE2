import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as usageCtrl from "../controllers/usageController.js";

/**
 * Mức dùng gói miễn phí của Cloudflare và trang "Quản lý hạ tầng". Route mới, backend cũ không có.
 *   route                  gắn ở /usage: ba chỉ số của hôm nay
 *   infrastructureRoutes   gắn ở /infrastructure: mọi số liệu của trang hạ tầng trong một lời gọi
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js. Cả hai chỉ dành cho quản trị viên, và vẫn phục vụ khi
 * hệ thống tạm ngừng vì hết hạn mức (middleware/quotaMiddleware.js).
 */
const route = new Hono();
route.use(authCtrl.restrictTo("admin"));
route.get("/", usageCtrl.getUsage);

export const infrastructureRoutes = new Hono();
infrastructureRoutes.use(authCtrl.restrictTo("admin"));
infrastructureRoutes.get("/", usageCtrl.getInfrastructure);

export default route;
