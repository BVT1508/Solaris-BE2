import * as shareLinkService from "../services/shareLinkService.js";
import AppError from "../utils/appError.js";
import { sha256Hex } from "../utils/hash.js";
import { socketIdOf } from "../utils/realtime.js";

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Xác thực khách: quyền nằm ở token của link, không có tài khoản hay cookie.
 * Gắn c.get("guest") = { link, deliverable, round, order, orderStatus, deviceHash, actor }:
 *   link         dòng share_links (đủ cột, kể cả token: KHÔNG trả ra API)
 *   deliverable  sản phẩm của link (đủ cột, kể cả sdkKey: KHÔNG trả ra API)
 *   round        vòng mới nhất của sản phẩm, hoặc null
 *   order        { id, status, title, type, client }
 *   orderStatus  trạng thái đơn (để chặn khi đơn đã bàn giao)
 *   deviceHash   băm SHA-256 của mã thiết bị, hoặc null khi request không gửi header X-Device-Id
 *   actor        { kind: "guest", orgId, orderId, deliverableId, shareLinkId, name, socketId }
 * Mã thiết bị (header X-Device-Id) do trình duyệt sinh ngẫu nhiên một lần và lưu lại; server chỉ giữ bản băm.
 * Đặt sau validate({ params }) để token đã đúng dạng. Lỗi của khách không bao giờ là 401 (frontend coi 401 là hết phiên thành viên).
 */
export const resolveGuest = async (c, next) => {
  const context = await shareLinkService.loadLinkContext(
    c.get("valid").params.token
  );

  const deviceId = c.req.header("x-device-id");
  if (deviceId !== undefined && !DEVICE_ID.test(deviceId)) {
    throw new AppError("Mã thiết bị không hợp lệ.", 400);
  }

  c.set("guest", {
    ...context,
    deviceHash: deviceId ? sha256Hex(deviceId) : null,
    actor: {
      kind: "guest",
      orgId: context.link.org,
      orderId: context.link.order,
      deliverableId: context.deliverable.id,
      shareLinkId: context.link.id,
      name: context.link.contactName,
      // Kết nối trực tiếp của chính tab này: thay đổi do nó gây ra không báo ngược lại cho nó.
      socketId: socketIdOf(c),
    },
  });
  await next();
};

/** Ghi dữ liệu thì bắt buộc có mã thiết bị, để biết bài nào của máy nào. */
export const requireDevice = async (c, next) => {
  if (!c.get("guest").deviceHash) {
    throw new AppError("Thiếu mã thiết bị (header X-Device-Id).", 400);
  }
  await next();
};
