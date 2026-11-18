import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as deliverableCtrl from "../controllers/deliverableController.js";
import validate from "../middleware/validateMiddleware.js";
import { versionOnlySchema } from "../validators/common.js";
import {
  deliverableIdParams,
  fileIdParams,
  listDeliverablesQuery,
  createDeliverableSchema,
  updateDeliverableSchema,
  createUploadSchema,
  attachFileSchema,
} from "../validators/deliverableValidator.js";

/**
 * Gói X2, sản phẩm bàn giao và file. `route` gắn ở /deliverables, `orderDeliverableRoutes` gắn ở /orders.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// Xem: ai trong đơn. Sửa: quản trị viên hoặc leader của đơn (policy trong service).
route.get(
  "/:id",
  validate({ params: deliverableIdParams }),
  deliverableCtrl.getDeliverable
);
route.patch(
  "/:id",
  validate({ params: deliverableIdParams, body: updateDeliverableSchema }),
  deliverableCtrl.updateDeliverable
);

// File của design, document: ai làm việc trong đơn (nhân viên, leader, quản trị viên).
// Ba bước: xin thông tin đẩy file đã ký, trình duyệt đẩy thẳng lên kho, đính file.
route.post(
  "/:id/uploads",
  validate({ params: deliverableIdParams, body: createUploadSchema }),
  deliverableCtrl.createUploadUrl
);
route.post(
  "/:id/files",
  validate({ params: deliverableIdParams, body: attachFileSchema }),
  deliverableCtrl.attachFile
);
route.delete(
  "/:id/files/:fileId",
  validate({ params: fileIdParams, body: versionOnlySchema }),
  deliverableCtrl.removeFile
);

// Lưu trữ, khôi phục, đổi khóa nhúng: chỉ quản trị viên.
route.post(
  "/:id/archive",
  authCtrl.restrictTo("admin"),
  validate({ params: deliverableIdParams, body: versionOnlySchema }),
  deliverableCtrl.archiveDeliverable
);
route.post(
  "/:id/restore",
  authCtrl.restrictTo("admin"),
  validate({ params: deliverableIdParams, body: versionOnlySchema }),
  deliverableCtrl.restoreDeliverable
);
route.post(
  "/:id/sdk-key/rotate",
  authCtrl.restrictTo("admin"),
  validate({ params: deliverableIdParams, body: versionOnlySchema }),
  deliverableCtrl.rotateSdkKey
);

// Sản phẩm bàn giao trong đơn. Xem: ai trong đơn. Tạo: quản trị viên hoặc leader của đơn (policy trong service).
export const orderDeliverableRoutes = new Hono();

orderDeliverableRoutes.get(
  "/:id/deliverables",
  validate({ params: deliverableIdParams, query: listDeliverablesQuery }),
  deliverableCtrl.getDeliverables
);
orderDeliverableRoutes.post(
  "/:id/deliverables",
  validate({ params: deliverableIdParams, body: createDeliverableSchema }),
  deliverableCtrl.createDeliverable
);

export default route;
