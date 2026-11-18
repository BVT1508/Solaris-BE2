import { Hono } from "hono";
import * as feedbackCtrl from "../controllers/feedbackController.js";
import validate from "../middleware/validateMiddleware.js";
import { deliverableIdParams } from "../validators/deliverableValidator.js";
import {
  feedbackIdParams,
  listDeliverableFeedbackQuery,
  listOrderFeedbackQuery,
  listMineQuery,
  createMemberFeedbackSchema,
  triageSchema,
  memberReplySchema,
  bridgeCheckSchema,
} from "../validators/feedbackValidator.js";

/**
 * Gói X4, góp ý phía team. `route` gắn ở /feedback, `deliverableFeedbackRoutes` ở /deliverables, `orderFeedbackRoutes` ở /orders.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// Việc của tôi. Đặt trước "/:id" để "mine" không bị hiểu là id.
route.get(
  "/mine",
  validate({ query: listMineQuery }),
  feedbackCtrl.getMyFeedback
);
route.get(
  "/:id",
  validate({ params: feedbackIdParams }),
  feedbackCtrl.getFeedback
);
// Đổi trạng thái, giao người.
route.patch(
  "/:id",
  validate({ params: feedbackIdParams, body: triageSchema }),
  feedbackCtrl.triageFeedback
);
route.delete(
  "/:id",
  validate({ params: feedbackIdParams }),
  feedbackCtrl.deleteFeedback
);
route.post(
  "/:id/replies",
  validate({ params: feedbackIdParams, body: memberReplySchema }),
  feedbackCtrl.createReply
);

// Góp ý của một sản phẩm. Xem: ai trong đơn (nháp của khách không hiện ở đây).
// Team tự thêm góp ý: nhân viên, leader, quản trị viên.
export const deliverableFeedbackRoutes = new Hono();

deliverableFeedbackRoutes.get(
  "/:id/feedback",
  validate({
    params: deliverableIdParams,
    query: listDeliverableFeedbackQuery,
  }),
  feedbackCtrl.getDeliverableFeedback
);
deliverableFeedbackRoutes.post(
  "/:id/feedback",
  validate({ params: deliverableIdParams, body: createMemberFeedbackSchema }),
  feedbackCtrl.createFeedback
);
// Kiểm khóa mà bridge trong site báo lên: ai trong đơn cũng gọi được (staff, viewer không xem được sdkKey để tự so).
deliverableFeedbackRoutes.post(
  "/:id/bridge-check",
  validate({ params: deliverableIdParams, body: bridgeCheckSchema }),
  feedbackCtrl.checkBridge
);

// Mọi góp ý của đơn (màn "Cần xử lý"): ai trong đơn.
export const orderFeedbackRoutes = new Hono();

orderFeedbackRoutes.get(
  "/:id/feedback",
  validate({ params: deliverableIdParams, query: listOrderFeedbackQuery }),
  feedbackCtrl.getOrderFeedback
);

export default route;
