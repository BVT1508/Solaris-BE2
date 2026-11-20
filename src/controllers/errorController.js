import { pausedResponse } from "../middleware/quotaMiddleware.js";
import { noteQuotaError } from "../services/usageService.js";
import env from "../config/env.js";
import { toAppError } from "../db/d1.js";
import AppError from "../utils/appError.js";
import logger from "../utils/logger.js";
import redactUrl from "../utils/redactUrl.js";

/** Đường dẫn kèm query như request gửi lên (req.originalUrl của Express). */
const originalUrl = (c) => {
  const url = new URL(c.req.url);
  return url.pathname + url.search;
};

/** Không route nào khớp. */
export const notFound = (c) => {
  throw new AppError(`Không tìm thấy ${originalUrl(c)} trên server.`, 404);
};

/**
 * Mọi lỗi đi về đây (app.onError). Định dạng trả về như backend cũ:
 *   4xx  { status: "fail", message }      lời báo tiếng Việt hiện thẳng cho người dùng
 *   5xx  { status: "error", message }     lời chung, không lộ chi tiết; chi tiết nằm trong log
 */
export const globalErrorHandler = (err, c) => {
  let error = err;

  // D1 báo tài khoản đã chạm trần ngày của gói miễn phí: không phải lỗi của hệ thống. Chuyển sang tạm ngừng và trả lời
  // như mọi request bị chặn lúc tạm ngừng, thay cho 500.
  if (noteQuotaError(err)) return pausedResponse(c);

  // Lỗi của D1 có nghĩa với người dùng (trùng khóa duy nhất, dữ liệu vừa đổi): đổi thành lời tiếng Việt.
  if (!error.isOperational) error = toAppError(error) || error;
  // Đường dẫn mã hóa hỏng (%E0%A4%A): lỗi của request, không phải của server.
  if (error instanceof URIError)
    error = new AppError("Yêu cầu không hợp lệ.", 400);

  if (!error.isOperational) {
    // Lỗi không lường trước: ghi log đủ, trả lời chung để không lộ chi tiết bên trong.
    logger.error(
      { err, url: redactUrl(originalUrl(c)), method: c.req.method },
      "Lỗi chưa xử lý"
    );
    return c.json(
      {
        status: "error",
        message: "Có lỗi, hãy thử lại.",
        ...(env.IS_DEV && { detail: err.message }),
      },
      500
    );
  }

  return c.json(
    { status: error.status, message: error.message },
    error.statusCode
  );
};
