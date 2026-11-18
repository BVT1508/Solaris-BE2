import { all, run, sql } from "../db/d1.js";
import AppError from "../utils/appError.js";
import { runAfterResponse } from "../utils/background.js";
import logger from "../utils/logger.js";
import { now } from "../utils/time.js";
import cloudinaryDriver from "./storage/cloudinaryDriver.js";

/**
 * Cửa duy nhất tới kho file. Hiện chỉ có Cloudinary (R2 để sau); mỗi file vẫn nhớ `provider` của nó,
 * nên thêm kho sau này thì file cũ vẫn đọc và xóa được ở kho cũ.
 *
 * Khác backend cũ ở cách xóa: không gọi kho ngay trong request. File thành thừa thì ghi vào bảng storage_trash
 * bằng `trashStatement` đặt trong cùng lô với thay đổi làm nó thừa (cùng thành hoặc cùng mất với database);
 * việc xóa thật chạy sau response (`emptyTrashSoon`) và trong cron mỗi giờ, theo lô.
 */
const DRIVERS = { cloudinary: cloudinaryDriver };
const active = cloudinaryDriver.enabled ? cloudinaryDriver : null;

const MB = 1024 * 1024;

/** Loại file nhận vào, theo loại thật mà kho ghi nhận (không tin phần mở rộng từ client). */
const FILE_RULES = {
  "image/png": { ext: "png", kind: "image", maxBytes: 15 * MB },
  "image/jpeg": { ext: "jpg", kind: "image", maxBytes: 15 * MB },
  "image/webp": { ext: "webp", kind: "image", maxBytes: 15 * MB },
  "application/pdf": { ext: "pdf", kind: "pdf", maxBytes: 30 * MB },
};
export const ALLOWED_CONTENT_TYPES = Object.keys(FILE_RULES);

export const assertStorageEnabled = () => {
  if (!active) throw new AppError("Chưa cấu hình kho file.", 503);
};

/** Luật của một loại file; trần dung lượng lấy mức thấp hơn giữa luật chung và giới hạn của kho đang bật. */
export const ruleFor = (contentType) => {
  const rule = FILE_RULES[contentType];
  if (!rule) return null;
  const driverMax = active?.limits[rule.kind] ?? rule.maxBytes;
  return { ...rule, maxBytes: Math.min(rule.maxBytes, driverMax) };
};

/** Key tạm: file vừa đẩy, chưa đính vào sản phẩm. File tạm quá 1 ngày sẽ bị dọn. */
export const pendingKey = (deliverableId, ext) =>
  `pending/${deliverableId}/${crypto.randomUUID()}.${ext}`;

export const pendingKeyPattern = (deliverableId) =>
  new RegExp(`^pending/${deliverableId}/[0-9a-f-]{36}\\.(png|jpg|webp|pdf)$`);

/** Key chính thức, theo đơn và sản phẩm để dọn theo tiền tố khi cần. */
export const finalKey = (orderId, deliverableId, ext) =>
  `orders/${orderId}/deliverables/${deliverableId}/${crypto.randomUUID()}.${ext}`;

/** Key của ảnh chụp màn hình kèm góp ý, nằm riêng thư mục shots của sản phẩm. */
export const shotKey = (orderId, deliverableId, ext) =>
  `orders/${orderId}/deliverables/${deliverableId}/shots/${crypto.randomUUID()}.${ext}`;

/** Key của ảnh chụp cả trang (bản theo vòng của sản phẩm web). */
export const pageShotKey = (orderId, deliverableId, ext) =>
  `orders/${orderId}/deliverables/${deliverableId}/pages/${crypto.randomUUID()}.${ext}`;

/** Lỗi của kho (mạng, hạn mức) thành một lời báo chung, ghi log chi tiết. */
async function guarded(action, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err, action, driver: active?.name }, "Lỗi kho file");
    throw new AppError("Kho file đang lỗi, hãy thử lại.", 502);
  }
}

/** Bước 1: thông tin để trình duyệt đẩy thẳng file lên kho. */
export async function createUpload(key, rule, contentType, bytes) {
  const upload = await guarded("createUpload", () =>
    active.createUpload(key, rule, contentType, bytes)
  );
  return {
    provider: active.name,
    key,
    ...upload,
    expiresIn: active.uploadSeconds,
  };
}

/** Bước 3: file tạm có thật không, loại gì, nặng bao nhiêu. null khi chưa đẩy. */
export const statPending = (key) => guarded("stat", () => active.stat(key));

/** width, height của ảnh hoặc pages của PDF: hệ quy chiếu cho góp ý theo tọa độ. */
export const measurePending = (key, rule, info) =>
  guarded("measure", () => active.measure(key, rule, info));

export const promote = (fromKey, toKey) =>
  guarded("promote", () => active.promote(fromKey, toKey));

export const activeProvider = () => active.name;

/** URL đọc cho một file đã lưu. null khi kho của file đó không còn được cấu hình. Không gọi mạng. */
export function readUrl(file) {
  const driver = DRIVERS[file.provider];
  if (!driver?.enabled) return null;
  return driver.readUrl(file.key);
}

/** Ảnh nhỏ để xem trước nếu kho dựng được (Cloudinary). null: frontend dùng `url`. */
export function thumbUrl(file) {
  const driver = DRIVERS[file.provider];
  if (!driver?.enabled || !driver.thumbUrl || !file.key) return null;
  return driver.thumbUrl(file.key);
}

/** Ảnh từng trang của PDF nếu kho dựng được (Cloudinary). null: frontend tự vẽ từ `url` bằng pdf.js. */
export function pageUrls(file) {
  const driver = DRIVERS[file.provider];
  if (!driver?.enabled || !driver.pageUrls || !file.pages) return null;
  return driver.pageUrls(file.key, file.pages);
}

// ---------- Xóa file: thùng rác ----------

/**
 * Câu lệnh đưa file vào thùng rác của kho, để đặt trong lô của `transact` (thay cho removeQuietly của backend cũ).
 * files: mảng { provider, key }; phần tử thiếu key bị bỏ qua. Mảng rỗng thì câu lệnh không chèn gì.
 */
export const trashStatement = (files) => sql`
  INSERT INTO storage_trash (provider, key, created_at)
  SELECT value ->> 'provider', value ->> 'key', ${now()}
  FROM json_each(${JSON.stringify(
    (files || [])
      .filter((file) => file?.key)
      .map(({ provider, key }) => ({ provider, key }))
  )})`;

/** Đưa file vào thùng rác ngoài lô (khi lô đã hỏng và cần dọn file vừa chuyển key). Lỗi chỉ ghi log. */
export async function trashQuietly(files) {
  try {
    await run(trashStatement(files));
    emptyTrashSoon();
  } catch (err) {
    logger.warn({ err }, "Không ghi được file vào thùng rác của kho");
  }
}

/**
 * Xóa trên kho tối đa `limit` file đang nằm trong thùng rác (mỗi kho một lời gọi cho tới 100 file), rồi bỏ chúng khỏi bảng.
 * Kho lỗi thì dòng nằm lại cho lượt sau. Trả số file đã xóa.
 */
export async function emptyTrash(limit = 100) {
  const rows = await all(
    sql`SELECT id, provider, key FROM storage_trash ORDER BY id LIMIT ${Math.min(limit, 100)}`
  );
  let deleted = 0;
  for (const [provider, driver] of Object.entries(DRIVERS)) {
    const mine = rows.filter((row) => row.provider === provider);
    if (mine.length === 0 || !driver.enabled) continue;
    try {
      await driver.removeMany(mine.map((row) => row.key));
      await run(
        sql`DELETE FROM storage_trash WHERE id IN ${sql.list(mine.map((row) => row.id))}`
      );
      deleted += mine.length;
    } catch (err) {
      logger.warn(
        { err, provider, files: mine.length },
        "Không xóa được file trên kho"
      );
    }
  }
  return deleted;
}

/** Gọi sau một lô có `trashStatement`: xóa sớm sau khi đã trả lời người dùng, không chờ cron. */
export const emptyTrashSoon = () =>
  runAfterResponse(() => emptyTrash(20), "dọn thùng rác kho file");

// ---------- File tạm ----------

/** File tạm sống tối đa 1 ngày: đủ cho mọi lần upload dở, không để rác tích lại. */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Dọn file tạm quá hạn ở mọi kho đang cấu hình. Lỗi chỉ ghi log. Trả số file đã xóa. */
export async function purgeStalePending(maxAgeMs = PENDING_MAX_AGE_MS) {
  let deleted = 0;
  for (const driver of Object.values(DRIVERS)) {
    if (!driver.enabled || !driver.purgePending) continue;
    try {
      deleted += await driver.purgePending(maxAgeMs);
    } catch (err) {
      logger.warn({ err, driver: driver.name }, "Không dọn được file tạm");
    }
  }
  return deleted;
}
