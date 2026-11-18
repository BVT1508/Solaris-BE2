import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import validate from "../middleware/validateMiddleware.js";
import { authLimiter } from "../middleware/rateLimitMiddleware.js";
import {
  devLoginSchema,
  googleCallbackSchema,
} from "../validators/authValidator.js";

const route = new Hono();

// Chủ hệ thống phải có mặt trước khi ai đó đăng nhập (kể cả trên database trống): kiểm ở các đường đăng nhập,
// một lần mỗi isolate. Không kiểm ở /me và /logout: hai đường đó chạy ở mọi lần tải trang và không cần chủ hệ thống,
// mà lần kiểm tốn hai lượt hỏi database đúng vào request đầu (đắt nhất) của một isolate mới.
// Đăng nhập dev: chỉ có khi chạy máy dev, chỉ nhận từ máy này.
route.get(
  "/dev/members",
  authCtrl.requireDevLogin,
  authCtrl.ensureOwner,
  authCtrl.getDevMembers
);
route.post(
  "/dev/login",
  authCtrl.requireDevLogin,
  authLimiter,
  validate({ body: devLoginSchema }),
  authCtrl.ensureOwner,
  authCtrl.devLogin
);

// Đăng nhập Google: trình duyệt mở /google, Google gọi về /google/callback.
route.get("/google", authLimiter, authCtrl.googleStart);
route.get(
  "/google/callback",
  authLimiter,
  validate({ query: googleCallbackSchema }),
  authCtrl.ensureOwner,
  authCtrl.googleCallback
);

route.get("/me", authCtrl.protect, authCtrl.getMe);
route.post("/logout", authCtrl.protect, authCtrl.logout);

export default route;
