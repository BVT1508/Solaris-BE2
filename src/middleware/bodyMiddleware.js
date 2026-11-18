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
const unsupported = () =>
  new AppError("Kiểu nội dung gửi lên không được hỗ trợ.", 415);

// Tham số charset của Content-Type, có hoặc không có nháy kép; khai nhiều lần thì lấy lần cuối (như gói content-type).
const CHARSET = /;\s*charset\s*=\s*(?:"([^"]*)"|([^\s;"]+))/gi;
const charsetOf = (type) => {
  let found;
  for (const match of type.matchAll(CHARSET)) found = match[1] ?? match[2];
  return (found ?? "utf-8").toLowerCase();
};

/** Như `hasBody` của body-parser: request có khai body (kể cả body rỗng với Content-Length: 0) thì mới xét tiếp. */
const hasBody = (c) => {
  const length = c.req.header("content-length");
  return (
    (length !== undefined && !Number.isNaN(Number(length))) ||
    c.req.header("transfer-encoding") !== undefined ||
    c.req.raw.body !== null
  );
};

export const parseBody = async (c, next) => {
  const type = c.req.header("content-type") || "";
  if (BODYLESS.has(c.req.method) || !/[/+]json\b/i.test(type)) {
    await next();
    return;
  }

  // Body-parser của backend cũ từ chối 415 trước khi đọc body, theo đúng thứ tự này: charset, rồi content-encoding.
  if (hasBody(c)) {
    // Chỉ nhận UTF-8. Bản cũ còn giải mã được UTF-16 và UTF-32 (không trình duyệt nào gửi JSON kiểu đó): ở đây cũng 415.
    if (charsetOf(type) !== "utf-8") throw unsupported();
    // Bản cũ tự giải nén gzip, deflate, br, zstd. Ở đây không giải nén (tốn CPU, và trần kích thước phải tính sau giải nén):
    // mọi content-encoding khác identity đều 415. Trình duyệt không nén body của request nên frontend không bị ảnh hưởng.
    const encoding = (c.req.header("content-encoding") || "identity")
      .trim()
      .toLowerCase();
    if (encoding !== "identity") throw unsupported();
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
