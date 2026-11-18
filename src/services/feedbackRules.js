import AppError from "../utils/appError.js";

/**
 * Luật thuần (không hỏi database) mà cả góp ý lẫn vòng review cùng dùng. Backend cũ để trong feedbackService và
 * roundService phải require ngược lại; tách ra đây để hai gói việc làm song song không chờ nhau.
 */

/** Đơn đã bàn giao là đã đóng: khách không gửi thêm gì cho tới khi team mở lại đơn. */
export function assertOrderOpen(orderStatus) {
  if (orderStatus === "delivered") {
    throw new AppError("Đơn đã bàn giao, không nhận góp ý thêm.", 409);
  }
}

/**
 * Khách chỉ gửi, sửa, xóa, xác nhận được khi link đang chia sẻ và vòng còn mở.
 * Nhận ngữ cảnh của khách (req.guest cũ): { link, round, orderStatus }.
 */
export function assertCanComment({ link, round, orderStatus }) {
  assertOrderOpen(orderStatus);
  if (link.status !== "active") {
    throw new AppError("Link đang tạm dừng, chưa gửi góp ý được.", 403);
  }
  if (!round || round.status === "submitted") {
    throw new AppError(
      "Vòng góp ý đã khép. Chờ team gửi bản sửa để góp ý tiếp.",
      409
    );
  }
  if (round.status === "approved") {
    throw new AppError("Sản phẩm đã được duyệt, không nhận góp ý nữa.", 409);
  }
}

/** Trang được ghim phải thuộc đúng site của sản phẩm: đường dẫn tương đối, hoặc cùng origin. */
export function assertSameSite(siteUrl, pageUrl) {
  // Ghép với địa chỉ site đúng như trình duyệt sẽ làm rồi so origin. Không tự đoán "bắt đầu bằng / là cùng site":
  // trình duyệt bỏ tab, xuống dòng và coi \\ như /, nên "/\\evil.com" hay "/<tab>/evil.com" thành site khác.
  let page;
  try {
    page = new URL(pageUrl, siteUrl);
  } catch {
    throw new AppError("Địa chỉ trang được ghim không hợp lệ.", 400);
  }
  if (page.origin !== new URL(siteUrl).origin) {
    throw new AppError("Trang được ghim không thuộc site của sản phẩm.", 400);
  }
}
