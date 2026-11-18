import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import validate from "../middleware/validateMiddleware.js";
import { authLimiter } from "../middleware/rateLimitMiddleware.js";
import {
  devLoginSchema,
  googleCallbackSchema,
} from "../validators/authValidator.js";

const route = new Hono();

route.use(authCtrl.ensureOwner);

// Đăng nhập dev: chỉ có khi chạy máy dev, chỉ nhận từ máy này.
route.get("/dev/members", authCtrl.requireDevLogin, authCtrl.getDevMembers);
route.post(
  "/dev/login",
  authCtrl.requireDevLogin,
  authLimiter,
  validate({ body: devLoginSchema }),
  authCtrl.devLogin
);

// Đăng nhập Google: trình duyệt mở /google, Google gọi về /google/callback.
route.get("/google", authLimiter, authCtrl.googleStart);
route.get(
  "/google/callback",
  authLimiter,
  validate({ query: googleCallbackSchema }),
  authCtrl.googleCallback
);

route.get("/me", authCtrl.protect, authCtrl.getMe);
route.post("/logout", authCtrl.protect, authCtrl.logout);

export default route;
