import { Hono } from "hono";
import * as guestCtrl from "../controllers/guestController.js";
import { requireDevice, resolveGuest } from "../middleware/guestMiddleware.js";
import {
  countedLimit,
  guestWriteLimiter,
} from "../middleware/rateLimitMiddleware.js";
import validate from "../middleware/validateMiddleware.js";
import { tokenParams } from "../validators/common.js";
import {
  guestFeedbackParams,
  createGuestFeedbackSchema,
  updateGuestFeedbackSchema,
  attachScreenshotSchema,
  guestReplySchema,
  verdictSchema,
  guestUploadSchema,
  bridgeCheckSchema,
} from "../validators/feedbackValidator.js";

/**
 * Gói X3, góp ý của khách. Gắn ở /r (không đăng nhập, quyền nằm ở token của link).
 * Giới hạn publicLimiter đã gắn cho cả /r ở routes/index.js.
 * Mã thiết bị gửi ở header X-Device-Id: đọc thì tùy chọn (để thấy nháp của mình), ghi thì bắt buộc.
 */
const route = new Hono();

// Khách xin chỗ đẩy ảnh chụp: đếm theo LINK chứ không theo IP hay mã thiết bị (cả hai đều đổi được),
// để một link bị lộ không thành chỗ đẩy file không giới hạn lên kho.
const guestUploadLimiter = countedLimit({
  key: (c) => `upload:${c.req.param("token")}`,
  limit: 60,
  windowMs: 10 * 60 * 1000,
});

route.get(
  "/:token/feedback",
  validate({ params: tokenParams }),
  resolveGuest,
  guestCtrl.getFeedback
);
route.post(
  "/:token/feedback",
  guestWriteLimiter,
  validate({ params: tokenParams, body: createGuestFeedbackSchema }),
  resolveGuest,
  requireDevice,
  guestCtrl.createFeedback
);
route.patch(
  "/:token/feedback/:id",
  guestWriteLimiter,
  validate({ params: guestFeedbackParams, body: updateGuestFeedbackSchema }),
  resolveGuest,
  requireDevice,
  guestCtrl.updateFeedback
);
// Đính ảnh chụp cho góp ý đã lưu: trình duyệt lưu góp ý trước, chụp và đẩy ảnh chạy nền rồi gọi vào đây.
route.put(
  "/:token/feedback/:id/screenshot",
  guestWriteLimiter,
  validate({ params: guestFeedbackParams, body: attachScreenshotSchema }),
  resolveGuest,
  requireDevice,
  guestCtrl.attachScreenshot
);
route.delete(
  "/:token/feedback/:id",
  guestWriteLimiter,
  validate({ params: guestFeedbackParams }),
  resolveGuest,
  requireDevice,
  guestCtrl.deleteFeedback
);

// Trả lời trong luồng của một góp ý đã gửi.
route.post(
  "/:token/feedback/:id/replies",
  guestWriteLimiter,
  validate({ params: guestFeedbackParams, body: guestReplySchema }),
  resolveGuest,
  requireDevice,
  guestCtrl.createReply
);
// Xác nhận một góp ý team đã báo sửa xong: "Đã đúng" hoặc "Cần sửa tiếp".
route.post(
  "/:token/feedback/:id/verdict",
  guestWriteLimiter,
  validate({ params: guestFeedbackParams, body: verdictSchema }),
  resolveGuest,
  requireDevice,
  guestCtrl.giveVerdict
);

// Site web: xin chỗ đẩy ảnh chụp màn hình, và kiểm khóa nhúng mà bridge báo lên.
route.post(
  "/:token/uploads",
  guestWriteLimiter,
  validate({ params: tokenParams, body: guestUploadSchema }),
  guestUploadLimiter,
  resolveGuest,
  requireDevice,
  guestCtrl.createUpload
);
route.post(
  "/:token/bridge-check",
  guestWriteLimiter,
  validate({ params: tokenParams, body: bridgeCheckSchema }),
  resolveGuest,
  guestCtrl.checkBridge
);

export default route;
