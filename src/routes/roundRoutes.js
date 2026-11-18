import { Hono } from "hono";
import * as roundCtrl from "../controllers/roundController.js";
import validate from "../middleware/validateMiddleware.js";
import {
  deliverableIdParams,
  openRoundSchema,
  pageShotUploadSchema,
  roundPagesSchema,
} from "../validators/roundValidator.js";

/**
 * Gói Y4, vòng review phía team. Gắn ở /deliverables.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// "Gửi khách xem lại": mở vòng kế. Quản trị viên hoặc leader của đơn (policy round.create trong service).
route.post(
  "/:id/rounds",
  validate({ params: deliverableIdParams, body: openRoundSchema }),
  roundCtrl.openRound
);
// Chụp lại bộ file cho vòng đang mở (tải nhầm ngay sau khi gửi); chỉ khi chưa ai góp ý trên vòng đó.
route.post(
  "/:id/rounds/current/refresh",
  validate({ params: deliverableIdParams }),
  roundCtrl.refreshRound
);
// Sản phẩm web: bản theo vòng là bộ ảnh chụp cả trang, do trình duyệt của team chụp qua bridge.
// Xin chỗ đẩy ảnh, đẩy thẳng lên kho, rồi lưu bộ ảnh (kèm vị trí các ghim) cho vòng mới nhất.
route.post(
  "/:id/shots",
  validate({ params: deliverableIdParams, body: pageShotUploadSchema }),
  roundCtrl.createPageShotUpload
);
route.put(
  "/:id/rounds/current/pages",
  validate({ params: deliverableIdParams, body: roundPagesSchema }),
  roundCtrl.setRoundPages
);

export default route;
