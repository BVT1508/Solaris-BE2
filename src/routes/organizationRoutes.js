import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as organizationCtrl from "../controllers/organizationController.js";

/**
 * Việc cấp tổ chức. Gắn ở /organization. Route mới, backend cũ không có.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js.
 *
 * Khóa nhúng chung: dán một đoạn script vào bộ khung website của team là dùng cho mọi sản phẩm web
 * (services/organizationService.js).
 */
const route = new Hono();

// Xem khóa và đoạn script: mọi thành viên làm việc (quản trị viên, quản lý, nhân viên). Người chỉ xem thì không.
route.get(
  "/embed",
  authCtrl.restrictTo("admin", "manager", "staff"),
  organizationCtrl.getEmbed
);
// Đổi khóa: chỉ quản trị viên. Khóa cũ hết hiệu lực ngay.
route.post(
  "/embed/rotate",
  authCtrl.restrictTo("admin"),
  organizationCtrl.rotateEmbed
);

export default route;
