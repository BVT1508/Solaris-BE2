import { Hono } from "hono";
import * as shareLinkCtrl from "../controllers/shareLinkController.js";
import validate from "../middleware/validateMiddleware.js";
import { versionOnlySchema } from "../validators/common.js";
import {
  createShareLinkSchema,
  deliverableIdParams,
  shareLinkIdParams,
  updateShareLinkSchema,
} from "../validators/shareLinkValidator.js";

/**
 * Gói Y3, link chia sẻ. `route` gắn ở /share-links, `deliverableShareLinkRoutes` gắn ở /deliverables.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// Thao tác trên một link. Quản trị viên hoặc leader của đơn (policy shareLink.manage trong service).
route.patch(
  "/:id",
  validate({ params: shareLinkIdParams, body: updateShareLinkSchema }),
  shareLinkCtrl.updateShareLink
);
route.post(
  "/:id/pause",
  validate({ params: shareLinkIdParams, body: versionOnlySchema }),
  shareLinkCtrl.pauseShareLink
);
route.post(
  "/:id/resume",
  validate({ params: shareLinkIdParams, body: versionOnlySchema }),
  shareLinkCtrl.resumeShareLink
);
route.post(
  "/:id/revoke",
  validate({ params: shareLinkIdParams, body: versionOnlySchema }),
  shareLinkCtrl.revokeShareLink
);

export const deliverableShareLinkRoutes = new Hono();

// Link chia sẻ và vòng review của sản phẩm. Tạo link: quản trị viên hoặc leader của đơn; xem: ai trong đơn.
deliverableShareLinkRoutes.get(
  "/:id/share-links",
  validate({ params: deliverableIdParams }),
  shareLinkCtrl.getShareLinks
);
deliverableShareLinkRoutes.post(
  "/:id/share-links",
  validate({ params: deliverableIdParams, body: createShareLinkSchema }),
  shareLinkCtrl.createShareLink
);
deliverableShareLinkRoutes.get(
  "/:id/rounds",
  validate({ params: deliverableIdParams }),
  shareLinkCtrl.getRounds
);

export default route;
