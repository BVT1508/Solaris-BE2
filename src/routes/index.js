import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import { publicLimiter } from "../middleware/rateLimitMiddleware.js";
import activityRoutes from "./activityRoutes.js";
import authRoutes from "./authRoutes.js";
import clientRoutes from "./clientRoutes.js";
import deliverableRoutes, {
  orderDeliverableRoutes,
} from "./deliverableRoutes.js";
import feedbackRoutes, {
  deliverableFeedbackRoutes,
  orderFeedbackRoutes,
} from "./feedbackRoutes.js";
import memberRoutes from "./memberRoutes.js";
import orderRoutes from "./orderRoutes.js";
import organizationRoutes from "./organizationRoutes.js";
import publicFeedbackRoutes from "./publicFeedbackRoutes.js";
import publicRoutes from "./publicRoutes.js";
import roundRoutes from "./roundRoutes.js";
import shareLinkRoutes, {
  deliverableShareLinkRoutes,
} from "./shareLinkRoutes.js";
import usageRoutes, { infrastructureRoutes } from "./usageRoutes.js";

/**
 * Gom route của /api/v1. File này đã gắn sẵn mọi file route của các gói việc (docs/kien-truc.md mục 12):
 * mỗi phiên code chỉ điền file route của gói mình, KHÔNG sửa file này.
 *
 * Backend cũ để route của nhiều nghiệp vụ chung một file (ví dụ /deliverables/:id/feedback nằm trong deliverableRoutes).
 * Ở đây mỗi nghiệp vụ một file, nhiều file cùng gắn vào một tiền tố, để hai phiên làm song song không chạm file nhau.
 * Vì vậy `protect` gắn một lần theo tiền tố ở đây (gắn trong từng file thì một request bị đọc phiên nhiều lần).
 */
const route = new Hono();

route.route("/auth", authRoutes);

// Mọi đường dưới các tiền tố này cần đăng nhập.
for (const prefix of [
  "/members",
  "/clients",
  "/orders",
  "/deliverables",
  "/share-links",
  "/feedback",
  "/usage",
  "/infrastructure",
  "/organization",
]) {
  route.use(`${prefix}/*`, authCtrl.protect);
}

route.route("/members", memberRoutes);
route.route("/clients", clientRoutes);

route.route("/orders", orderRoutes);
route.route("/orders", orderDeliverableRoutes);
route.route("/orders", orderFeedbackRoutes);
route.route("/orders", activityRoutes);

route.route("/deliverables", deliverableRoutes);
route.route("/deliverables", deliverableShareLinkRoutes);
route.route("/deliverables", roundRoutes);
route.route("/deliverables", deliverableFeedbackRoutes);

route.route("/share-links", shareLinkRoutes);
route.route("/feedback", feedbackRoutes);

// Mức dùng gói miễn phí của Cloudflare, cho quản trị viên. Route mới, backend cũ không có.
route.route("/usage", usageRoutes);
route.route("/infrastructure", infrastructureRoutes);

// Việc cấp tổ chức: khóa nhúng chung cho mọi sản phẩm web. Route mới, backend cũ không có.
route.route("/organization", organizationRoutes);

// Khách mở link chia sẻ, không đăng nhập. Giới hạn tốc độ riêng vì ai có link (hoặc đang dò token) cũng gọi được.
route.use("/r/*", publicLimiter);
route.route("/r", publicRoutes);
route.route("/r", publicFeedbackRoutes);

export default route;
