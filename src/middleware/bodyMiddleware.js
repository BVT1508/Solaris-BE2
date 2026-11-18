import AppError from "../utils/appError.js";

/**
 * Đọc body JSON một lần cho mọi request, như express.json của backend cũ (chạy trước giới hạn tần suất và kiểm Origin).
 * Ảnh không đi qua API (trình duyệt đẩy thẳng lên kho) nên trần nhỏ: 100 KB.
 * Riêng bộ ảnh trang của vòng (tối đa 30 trang, mỗi trang 300 ghim) được 1 MB.
 * Kết quả ở c.get("rawBody"): object đã parse, hoặc undefined khi request không gửi JSON.
 */
const DEFAULT_LIMIT = 100 * 1024;
const PAGES_LIMIT = 1024 * 1024;
const PAGES_ROUTE =
  /^\/api\/v1\/deliverables\/[^/]+\/rounds\/current\/pages\/?$/;

const BODYLESS = new Set(["GET", "HEAD", "OPTIONS"]);

const tooLarge = () => new AppError("Nội dung gửi lên quá lớn.", 413);
const badJson = () =>
  new AppError("Nội dung gửi lên không phải JSON hợp lệ.", 400);

export const parseBody = async (c, next) => {
  const type = c.req.header("content-type") || "";
  if (BODYLESS.has(c.req.method) || !/[/+]json\b/i.test(type)) {
    await next();
    return;
  }

  const limit = PAGES_ROUTE.test(c.req.path) ? PAGES_LIMIT : DEFAULT_LIMIT;
  // Content-Length khai quá trần thì từ chối luôn, không đọc.
  if (Number(c.req.header("content-length") || 0) > limit) throw tooLarge();
  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength > limit) throw tooLarge();

  if (bytes.byteLength > 0) {
    const text = new TextDecoder().decode(bytes);
    // Như chế độ strict của body-parser: chỉ nhận object hoặc mảng.
    if (!/^\s*[[{]/.test(text)) throw badJson();
    try {
      c.set("rawBody", JSON.parse(text));
    } catch {
      throw badJson();
    }
  } else {
    c.set("rawBody", {});
  }
  await next();
};
