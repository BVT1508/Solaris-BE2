import { Hono } from "hono";
import * as activityCtrl from "../controllers/activityController.js";
import validate from "../middleware/validateMiddleware.js";
import { listActivityQuery } from "../validators/activityValidator.js";
import { orderIdParams } from "../validators/orderValidator.js";

/**
 * Gói Y2, nhật ký hoạt động. Gắn ở /orders.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// Hoạt động của đơn (ai làm gì, lúc nào): ai trong đơn cũng xem được, mỗi vai trò thấy một phần (activityService).
route.get(
  "/:id/activity",
  validate({ params: orderIdParams, query: listActivityQuery }),
  activityCtrl.getOrderActivity
);

export default route;
