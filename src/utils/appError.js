/**
 * Lỗi nghiệp vụ: lời báo đã viết sẵn để hiện cho người dùng.
 * 4xx → status "fail", 5xx → status "error".
 */
export default class AppError extends Error {
  constructor(message, statusCode) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
  }
}

/** Hai người sửa cùng lúc: người sau nhận lời này (khóa lạc quan bằng version). */
export const STALE = () =>
  new AppError("Dữ liệu vừa thay đổi. Hãy thử lại.", 409);
