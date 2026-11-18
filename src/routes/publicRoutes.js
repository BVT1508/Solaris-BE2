import { Hono } from "hono";
import * as roundCtrl from "../controllers/roundController.js";
import * as shareLinkCtrl from "../controllers/shareLinkController.js";
import { requireDevice, resolveGuest } from "../middleware/guestMiddleware.js";
import { guestWriteLimiter } from "../middleware/rateLimitMiddleware.js";
import validate from "../middleware/validateMiddleware.js";
import { tokenParams } from "../validators/common.js";

/**
 * Gói Y3 và Y4, khách mở link và khép vòng. Gắn ở /r (không đăng nhập, quyền nằm ở token của link).
 * Giới hạn publicLimiter đã gắn cho cả /r ở routes/index.js.
 * Các đường góp ý của khách (/r/:token/feedback...) nằm ở publicFeedbackRoutes.js.
 */
const route = new Hono();

route.get(
  "/:token",
  validate({ params: tokenParams }),
  shareLinkCtrl.openReview
);

// "Gửi góp ý cho team" khép vòng; "Duyệt" kết thúc sản phẩm.
route.post(
  "/:token/submit",
  guestWriteLimiter,
  validate({ params: tokenParams }),
  resolveGuest,
  requireDevice,
  roundCtrl.submitRound
);
route.post(
  "/:token/approve",
  guestWriteLimiter,
  validate({ params: tokenParams }),
  resolveGuest,
  requireDevice,
  roundCtrl.approveRound
);

export default route;
