import { Hono } from "hono";
import authRoutes from "./authRoutes.js";

/**
 * Gom route của /api/v1. Mỗi gói việc thêm đúng MỘT dòng import và MỘT dòng route.route ở đây
 * (xem docs/kien-truc.md mục 12); thứ tự như backend cũ.
 */
const route = new Hono();

route.route("/auth", authRoutes);
// route.route("/members", memberRoutes);
// route.route("/clients", clientRoutes);
// route.route("/orders", orderRoutes);
// route.route("/deliverables", deliverableRoutes);
// route.route("/share-links", shareLinkRoutes);
// route.route("/feedback", feedbackRoutes);
// Khách mở link chia sẻ, không đăng nhập.
// route.route("/r", publicRoutes);

export default route;
