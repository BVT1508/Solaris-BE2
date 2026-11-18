import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as orderCtrl from "../controllers/orderController.js";
import validate from "../middleware/validateMiddleware.js";
import { versionOnlySchema } from "../validators/common.js";
import {
  orderIdParams,
  listOrdersQuery,
  createOrderSchema,
  updateOrderSchema,
  setOrderMembersSchema,
} from "../validators/orderValidator.js";

/**
 * Gói Y1, đơn hàng. Gắn ở /orders.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 * Sản phẩm của đơn, góp ý của đơn và hoạt động của đơn nằm ở file route của gói tương ứng (cùng tiền tố /orders).
 */
const route = new Hono();

// Mọi thành viên: danh sách và chi tiết lọc theo quyền trong service.
route.get("/", validate({ query: listOrdersQuery }), orderCtrl.getOrders);
route.get("/:id", validate({ params: orderIdParams }), orderCtrl.getOrder);

// Sửa: quản trị viên hoặc leader của đơn (policy order.update).
route.patch(
  "/:id",
  validate({ params: orderIdParams, body: updateOrderSchema }),
  orderCtrl.updateOrder
);

// Tạo đơn: chỉ quản trị viên.
route.post(
  "/",
  authCtrl.restrictTo("admin"),
  validate({ body: createOrderSchema }),
  orderCtrl.createOrder
);

// Team của đơn: quản trị viên đổi mọi thứ (cả leader); leader của đơn chỉ thêm bớt nhân viên (policy order.team, luật trong service).
// Danh sách cho hộp "Sửa team": team hiện tại và những người mà người gọi được thêm vào (GET /members chỉ dành cho quản trị viên).
route.get(
  "/:id/assignable-members",
  validate({ params: orderIdParams }),
  orderCtrl.getAssignableMembers
);
route.put(
  "/:id/members",
  validate({ params: orderIdParams, body: setOrderMembersSchema }),
  orderCtrl.setOrderMembers
);

// Bàn giao (khách đã duyệt mọi sản phẩm, hoặc đơn không có sản phẩm) và mở lại đơn đã bàn giao. Quản trị viên hoặc leader của đơn.
route.post(
  "/:id/deliver",
  validate({ params: orderIdParams, body: versionOnlySchema }),
  orderCtrl.deliverOrder
);
route.post(
  "/:id/reopen",
  validate({ params: orderIdParams, body: versionOnlySchema }),
  orderCtrl.reopenOrder
);

export default route;
