import env from "../../config/env.js";
import {
  THUMB_TRANSFORMATION,
  pageTransformation,
  signParams,
  signedUrl,
} from "./cloudinarySign.js";

/**
 * Driver Cloudinary, gọi thẳng API bằng fetch (backend cũ dùng SDK Node, không chạy được trong Worker).
 *
 * - Bước đẩy file là POST multipart (trường `file` kèm các `fields` đã ký) từ trình duyệt thẳng lên Cloudinary.
 * - Cloudinary tự đo: width, height, pages có sẵn khi hỏi thông tin file, không phải tải về.
 * - File để dạng "authenticated": chỉ URL có chữ ký do server sinh mới đọc được, nhưng URL không hết hạn.
 *
 * Hai loại API của Cloudinary:
 *   Upload API (rename, destroy)       xác thực bằng chữ ký trong body (api_key, timestamp, signature)
 *   Admin API (resources, xóa theo lô) xác thực bằng Basic; giới hạn 500 lời gọi mỗi giờ ở gói miễn phí
 */

const MB = 1024 * 1024;

/** Chữ ký upload của Cloudinary sống 1 giờ kể từ timestamp. */
const UPLOAD_SECONDS = 60 * 60;

/** PDF cũng nằm trong resource_type "image" để Cloudinary đếm trang và dựng ảnh từng trang. */
const TYPE = "authenticated";

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

const config = env.CLOUDINARY;
const apiBase = config
  ? `https://api.cloudinary.com/v1_1/${config.cloudName}`
  : null;

/** Key chung "pending/<id>/<uuid>.png" ứng với public_id "solaris/pending/<id>/<uuid>" (không có đuôi). */
const publicId = (key) => `solaris/${key.replace(/\.[^./]+$/, "")}`;
const extOf = (key) => key.slice(key.lastIndexOf(".") + 1);

const nowSeconds = () => Math.round(Date.now() / 1000);

/** Lỗi của Cloudinary: giữ mã HTTP để nơi gọi phân biệt "không có file" với lỗi thật. Không ghi body (có thể chứa khóa). */
class CloudinaryError extends Error {
  constructor(action, status, detail) {
    super(`Cloudinary ${action} trả ${status}${detail ? `: ${detail}` : ""}`);
    this.httpCode = status;
  }
}

const parse = async (action, response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CloudinaryError(action, response.status, body?.error?.message);
  }
  return body;
};

/** Gọi Upload API: ký mọi tham số (trừ api_key) rồi gửi dạng form. */
async function uploadApi(action, params) {
  const signed = { ...params, timestamp: nowSeconds() };
  const body = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(signed).map(([key, value]) => [key, String(value)])
    ),
    api_key: config.apiKey,
    signature: signParams(signed, config.apiSecret),
  });
  return parse(
    action,
    await fetch(`${apiBase}/image/${action}`, { method: "POST", body })
  );
}

/** Gọi Admin API. */
async function adminApi(method, path, query) {
  const url = new URL(`${apiBase}/${path}`);
  for (const [key, value] of query || []) url.searchParams.append(key, value);
  return parse(
    `${method} ${path.split("/")[0]}`,
    await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`,
      },
    })
  );
}

const isNotFound = (err) => err?.httpCode === 404;

/** Thông tin file mà Cloudinary trả (khi hỏi, hoặc sau khi đổi tên) thành dạng chung của kho. */
const toInfo = (resource) => {
  const isPdf = resource.format === "pdf";
  return {
    contentType: CONTENT_TYPES[resource.format] || "application/octet-stream",
    bytes: resource.bytes,
    measured: isPdf
      ? { pages: resource.pages || 1 }
      : { width: resource.width, height: resource.height },
  };
};

/** Các trường phải gửi kèm file. allowed_formats nằm trong chữ ký nên Cloudinary từ chối file sai loại. */
async function createUpload(key, rule) {
  const params = {
    allowed_formats: rule.ext,
    public_id: publicId(key),
    timestamp: nowSeconds(),
    type: TYPE,
  };
  return {
    uploadUrl: `${apiBase}/image/upload`,
    method: "POST",
    fileField: "file",
    fields: {
      ...params,
      api_key: config.apiKey,
      signature: signParams(params, config.apiSecret),
    },
  };
}

/** null khi file không có trên kho. Kèm luôn số đo vì Cloudinary trả sẵn. */
async function stat(key) {
  try {
    const path = `resources/image/${TYPE}/${publicId(key)
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    return toInfo(await adminApi("GET", path, [["pages", "true"]]));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function measure(key, rule, info) {
  return info.measured;
}

/** Đổi tên trên Cloudinary; bản tạm biến mất luôn. */
async function promote(fromKey, toKey) {
  await uploadApi("rename", {
    from_public_id: publicId(fromKey),
    to_public_id: publicId(toKey),
    type: TYPE,
  });
}

// Chữ ký của một URL chỉ phụ thuộc key và phép biến đổi, không đổi theo thời gian: nhớ lại trong isolate
// để các response lặp lại cùng file (danh sách, mọi vòng của một sản phẩm) không băm lại.
const urlCache = new Map();
const URL_CACHE_MAX = 5000;

const cachedUrl = (key, format, transformation) => {
  const cacheKey = `${key}|${format}|${transformation}`;
  let url = urlCache.get(cacheKey);
  if (!url) {
    url = signedUrl(config, publicId(key), format, transformation);
    if (urlCache.size >= URL_CACHE_MAX) urlCache.clear();
    urlCache.set(cacheKey, url);
  }
  return url;
};

const readUrl = (key) => cachedUrl(key, extOf(key), "");

/**
 * Ảnh nhỏ (rộng tối đa 480px, JPG) cho ô xem trước, lưới file, thanh phiên bản: không bắt trình duyệt tải ảnh gốc
 * nặng vài MB chỉ để vẽ một ô vài chục pixel. PDF thì lấy trang đầu.
 */
const thumbUrl = (key) => cachedUrl(key, "jpg", THUMB_TRANSFORMATION);

/** Tối đa bấy nhiêu trang có URL ảnh; PDF dài hơn thì frontend xin thêm sau. */
const MAX_PAGE_URLS = 100;

/**
 * Ảnh JPG của từng trang PDF, đã ký. Tài khoản miễn phí bị chặn phát PDF gốc
 * (trừ khi bật Security > "Allow delivery of PDF and ZIP files") nhưng ảnh trang thì phát được,
 * và màn review cũng cần ảnh để ghim góp ý theo tọa độ.
 */
function pageUrls(key, pages) {
  const count = Math.min(pages || 0, MAX_PAGE_URLS);
  return Array.from({ length: count }, (_, i) =>
    cachedUrl(key, "jpg", pageTransformation(i + 1))
  );
}

/** Xóa nhiều file trong một lời gọi (tối đa 100). File đã không còn cũng coi là xong. */
async function removeMany(keys) {
  if (keys.length === 0) return;
  await adminApi("DELETE", `resources/image/${TYPE}`, [
    ...keys.map((key) => ["public_ids[]", publicId(key)]),
    ["invalidate", "true"],
  ]);
}

/**
 * Xóa file tạm (đã đẩy lên nhưng không đính vào sản phẩm) cũ hơn `olderThanMs`. Trả số file đã xóa.
 * Mỗi lượt tối đa 3 trang x 100 file (giữ dưới trần lời gọi ra ngoài của một lượt cron); còn sót thì lượt sau xử lý tiếp.
 */
async function purgePending(olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  let deleted = 0;
  let cursor;
  for (let page = 0; page < 3; page += 1) {
    const list = await adminApi("GET", `resources/image/${TYPE}`, [
      ["prefix", "solaris/pending/"],
      ["max_results", "100"],
      ...(cursor ? [["next_cursor", cursor]] : []),
    ]);
    const stale = (list.resources || [])
      .filter((r) => new Date(r.created_at).getTime() < cutoff)
      .map((r) => r.public_id);
    if (stale.length) {
      await adminApi("DELETE", `resources/image/${TYPE}`, [
        ...stale.map((id) => ["public_ids[]", id]),
        ["invalidate", "true"],
      ]);
      deleted += stale.length;
    }
    cursor = list.next_cursor;
    if (!cursor) break;
  }
  return deleted;
}

export default {
  name: "cloudinary",
  enabled: Boolean(config),
  // Gói miễn phí của Cloudinary chặn ảnh và PDF trên 10 MB.
  limits: { image: 10 * MB, pdf: 10 * MB },
  uploadSeconds: UPLOAD_SECONDS,
  createUpload,
  stat,
  measure,
  promote,
  readUrl,
  thumbUrl,
  pageUrls,
  removeMany,
  purgePending,
};
