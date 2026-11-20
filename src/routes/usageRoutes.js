import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as usageCtrl from "../controllers/usageController.js";

/**
 * Mức dùng gói miễn phí của Cloudflare trong ngày. Gắn ở /usage. Route mới, backend cũ không có.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js.
 */
const route = new Hono();

// Chỉ quản trị viên.
route.use(authCtrl.restrictTo("admin"));

route.get("/", usageCtrl.getUsage);

export default route;
