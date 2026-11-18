import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as clientCtrl from "../controllers/clientController.js";
import validate from "../middleware/validateMiddleware.js";
import {
  clientIdParams,
  listClientsQuery,
  updateClientSchema,
} from "../validators/clientValidator.js";

/**
 * Gói Y1, khách hàng. Gắn ở /clients.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// Khách hàng: chỉ quản trị viên. Không có POST: khách sinh ra khi tạo đơn hàng.
route.use(authCtrl.restrictTo("admin"));

route.get("/", validate({ query: listClientsQuery }), clientCtrl.getClients);
route.get("/:id", validate({ params: clientIdParams }), clientCtrl.getClient);
route.patch(
  "/:id",
  validate({ params: clientIdParams, body: updateClientSchema }),
  clientCtrl.updateClient
);

export default route;
