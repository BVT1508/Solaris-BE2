import { Hono } from "hono";
import * as shareLinkCtrl from "../controllers/shareLinkController.js";
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

export default route;
