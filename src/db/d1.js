import { binding, dry } from "../config/runtime.js";
import AppError, { STALE } from "../utils/appError.js";
import { countRows } from "./usageCounter.js";

/**
 * Lớp truy vấn D1 mỏng, không ORM. Ba thứ cần nhớ:
 *
 * 1. Mọi câu SQL viết bằng thẻ `sql`. Giá trị chèn vào bằng ${...} luôn thành tham số ràng buộc (dấu ?),
 *    không bao giờ nối vào chuỗi SQL, nên không có đường cho SQL injection:
 *
 *      const member = await first(sql`SELECT * FROM members WHERE email = ${email}`);
 *
 * 2. Ghi nhiều bảng cùng thành hoặc cùng mất thì dùng `transact` (D1 không có giao dịch đọc rồi ghi, chỉ có batch):
 *    đọc và kiểm bằng JavaScript trước, rồi gửi một lô câu lệnh; đầu lô là các `guard` khẳng định lại những điều
 *    vừa đọc vẫn còn đúng. Một guard sai là cả lô bị hoàn tác. Xem docs/kien-truc.md mục 3.
 *
 * 3. Danh sách giá trị cho IN: dùng sql.list(mảng), không tự nối dấu ? (D1 chỉ nhận 100 tham số mỗi câu).
 *
 * Mọi câu chạy qua file này đều được đếm số dòng đọc và ghi (meta của kết quả) vào bộ đếm mức dùng gói miễn phí
 * (usageCounter.js, chỉ cộng số trong bộ nhớ). Vì vậy KHÔNG gọi thẳng `db().prepare(...)` ở nơi khác: câu đó sẽ không được đếm.
 */

/** Database D1 của Worker. */
export const db = () => binding("DB");

class Sql {
  constructor(text, params) {
    this.text = text;
    this.params = params;
  }
}

/** Đổi giá trị JavaScript sang kiểu D1 nhận: undefined thành NULL, boolean thành 0/1, Date thành chuỗi ISO, object thành JSON. */
const toParam = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
};

/** Thẻ dựng câu SQL. Giá trị là một mảnh `sql` khác thì ghép vào; còn lại thành tham số ràng buộc. */
export function sql(strings, ...values) {
  let text = strings[0];
  const params = [];
  values.forEach((value, index) => {
    if (value instanceof Sql) {
      text += value.text;
      params.push(...value.params);
    } else {
      text += "?";
      params.push(toParam(value));
    }
    text += strings[index + 1];
  });
  return new Sql(text, params);
}

/**
 * Chèn nguyên văn một đoạn SQL. CHỈ dùng cho chữ do chính code viết (tên cột, tên bảng, ORDER BY cố định).
 * Không bao giờ truyền dữ liệu đến từ người dùng vào đây.
 */
sql.raw = (text) => new Sql(text, []);

/** true khi giá trị là một mảnh sql (để phân biệt với dữ liệu thường). */
sql.is = (value) => value instanceof Sql;

/** Ghép nhiều mảnh bằng một dấu phân cách (mặc định dấu phẩy). */
sql.join = (parts, separator = ", ") => {
  const out = new Sql("", []);
  parts.forEach((part, index) => {
    if (index > 0) out.text += separator;
    out.text += part.text;
    out.params.push(...part.params);
  });
  return out;
};

/** Ghép các điều kiện bằng AND; danh sách rỗng thành điều kiện luôn đúng. */
sql.and = (parts) =>
  parts.length ? sql.join(parts, " AND ") : sql.raw("1 = 1");

/** Ghép các điều kiện bằng OR, có ngoặc; danh sách rỗng thành điều kiện luôn sai. */
sql.or = (parts) =>
  parts.length ? sql`(${sql.join(parts, " OR ")})` : sql.raw("1 = 0");

/**
 * Danh sách giá trị cho IN, truyền bằng MỘT tham số JSON nên không đụng trần 100 tham số của D1:
 *   sql`SELECT * FROM members WHERE id IN ${sql.list(ids)}`
 */
sql.list = (values) =>
  sql`(SELECT value FROM json_each(${JSON.stringify([...values])}))`;

const prepare = (query) => {
  if (!(query instanceof Sql)) {
    throw new TypeError("Câu truy vấn phải viết bằng thẻ sql`...`.");
  }
  return db()
    .prepare(query.text)
    .bind(...query.params);
};

/** Ghi nhận số dòng đọc, ghi của một kết quả D1 rồi trả lại chính kết quả đó. */
const counted = (result) => {
  // Lúc làm nóng (chạy khô với database giả) thì không đếm.
  if (!dry()) countRows(result.meta);
  return result;
};

/** Dòng đầu tiên (object theo tên cột), hoặc null. Dùng `all()` thay cho `first()` của D1 vì `first()` không trả meta để đếm. */
export const first = async (query) =>
  counted(await prepare(query).all()).results[0] ?? null;

/** Mọi dòng. */
export const all = async (query) => counted(await prepare(query).all()).results;

/** Chạy câu ghi. Trả { changes } là số dòng bị đổi; câu có RETURNING thì kèm rows. */
export const run = async (query) => {
  const result = counted(await prepare(query).run());
  return { changes: result.meta.changes, rows: result.results || [] };
};

/** Nhiều câu đọc độc lập trong một lượt đi về (thay cho Promise.all của nhiều truy vấn). Trả mảng các mảng dòng. */
export const readAll = async (queries) =>
  (await db().batch(queries.map(prepare))).map(
    (result) => counted(result).results
  );

// ---------- Ghi nhiều bước: batch có điều kiện bảo vệ ----------

const GUARD_ERROR = /TX_GUARD:([A-Za-z0-9_.-]*)/;
const UNIQUE_ERROR = /UNIQUE constraint failed: ([A-Za-z0-9_., ]+)/;

/**
 * Điều kiện bảo vệ trong một lô `transact`: câu SELECT phải trả ít nhất một dòng, không thì cả lô bị hoàn tác.
 *   guard(sql`SELECT 1 FROM members WHERE id = ${id} AND version = ${version}`, "stale")
 * label (chữ, số, gạch dưới) để `transact` biết guard nào sai và báo đúng lời.
 */
export const guard = (existsQuery, label = "") =>
  sql`INSERT INTO tx_guard (ok, label) SELECT EXISTS (${existsQuery}), ${label}`;

/** Ngược lại: câu SELECT phải KHÔNG trả dòng nào. */
export const guardNot = (existsQuery, label = "") =>
  sql`INSERT INTO tx_guard (ok, label) SELECT NOT EXISTS (${existsQuery}), ${label}`;

/** Lỗi do một guard sai: trả nhãn của guard (chuỗi rỗng nếu không đặt nhãn); không phải lỗi guard thì trả null. */
export const guardLabelOf = (err) => {
  const match = GUARD_ERROR.exec(String(err?.message || ""));
  return match ? match[1] : null;
};

/**
 * Lỗi trùng khóa duy nhất: trả danh sách "bảng.cột" bị trùng, ví dụ ["feedback.deliverable_id", "feedback.client_id"];
 * không phải thì trả null. Dùng cho thao tác idempotent (gửi lại cùng clientId thì trả bài cũ).
 */
export const uniqueViolationOf = (err) => {
  const match = UNIQUE_ERROR.exec(String(err?.message || ""));
  return match ? match[1].split(",").map((column) => column.trim()) : null;
};

/** Chạy một lô câu lệnh nguyên tử: tất cả thành công, hoặc không câu nào có hiệu lực. Trả mảng { changes, rows }. */
export const batch = async (queries) =>
  (await db().batch(queries.map(prepare))).map((result) => ({
    changes: counted(result).meta.changes,
    rows: result.results || [],
  }));

/**
 * Thay cho withTransaction của backend cũ.
 *
 *   return transact(async () => {
 *     // 1. Đọc và kiểm bằng JavaScript; ném AppError nếu luật không cho.
 *     const member = await findTarget(actor, id);
 *     if (member.version !== input.version) throw STALE();
 *     // 2. Trả lô câu lệnh: guard trước, ghi sau, nhật ký cuối.
 *     return {
 *       statements: [
 *         guard(sql`SELECT 1 FROM members WHERE id = ${id} AND version = ${input.version}`, "stale"),
 *         sql`UPDATE members SET ... WHERE id = ${id} RETURNING *`,
 *         auditStatement({ ... }),
 *       ],
 *       // 3. Dựng kết quả từ kết quả của lô (results[i] ứng với statements[i]).
 *       done: (results) => toPublic(Member.fromRow(results[1].rows[0])),
 *     };
 *   }, { errors: { stale: STALE } });
 *
 * Khi một guard sai:
 *   - nhãn có trong `errors`: ném ngay lỗi đó (ví dụ version cũ thì 409, không cần thử lại);
 *   - nhãn khác: dữ liệu vừa bị người khác đổi giữa lúc đọc và lúc ghi. Chạy lại hàm `plan` từ đầu (tối đa `retries` lần),
 *     lần chạy lại đọc dữ liệu mới và tự ra đúng lời báo, giống giao dịch MongoDB tự chạy lại khi đụng nhau.
 *     Hết lượt thì ném 409 "Dữ liệu vừa thay đổi. Hãy thử lại.".
 * Hàm `plan` vì vậy phải chạy lại được: lời gọi ra ngoài (kho file) đặt TRƯỚC `transact`, không đặt trong `plan`.
 * Lô rỗng (không có gì để ghi) được phép: `done` nhận mảng rỗng.
 *
 * Hai luật cho guard:
 *   - Guard dựa trên dữ liệu đọc NGOÀI `plan` (ví dụ ngữ cảnh của khách do middleware nạp) phải có nhãn nằm trong `errors`:
 *     chạy lại `plan` không đọc lại dữ liệu đó, nên guard không nhãn chỉ chạy lại vô ích rồi ra 409 chung.
 *   - Điều kiện SQL của guard không nhãn phải trùng câu kiểm JavaScript trong `plan`. Lệch nhau thì `plan` luôn cho qua
 *     còn guard luôn sai: thành 409 vĩnh viễn (frontend tự lưu lại khi gặp 409).
 * Trong `done`, results[i] ứng với statements[i]: guard chèn có điều kiện làm lệch chỉ số, nên đặt câu cần đọc kết quả
 * ở vị trí cố định (trước các guard tùy chọn) hoặc tính chỉ số từ chính mảng statements.
 */
export async function transact(plan, { errors = {}, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const { statements = [], done } = (await plan(attempt)) || {};
    let results;
    try {
      results = statements.length ? await batch(statements) : [];
    } catch (err) {
      const label = guardLabelOf(err);
      if (label === null) throw err;
      if (Object.hasOwn(errors, label)) throw errors[label]();
      if (attempt >= retries) throw STALE();
      continue;
    }
    // Lô đã ghi xong. `done` chạy ngoài try: lỗi của nó không bao giờ bị hiểu là guard sai rồi chạy lại (ghi trùng).
    return done ? done(results) : undefined;
  }
}

/** Lỗi của D1 thành lời báo cho người dùng, hoặc null nếu là lỗi không lường trước (để errorController trả 500). */
export function toAppError(err) {
  const message = String(err?.message || "");
  if (!message.includes("D1_ERROR")) return null;
  if (guardLabelOf(err) !== null) return STALE();
  const unique = uniqueViolationOf(err);
  if (unique) {
    const fields = unique.map((column) => column.split(".").pop()).join(", ");
    return new AppError(`Dữ liệu bị trùng (${fields}). Hãy thử lại!`, 409);
  }
  if (/(CHECK|NOT NULL|FOREIGN KEY) constraint failed/.test(message)) {
    return new AppError("Dữ liệu không hợp lệ.", 400);
  }
  return null;
}
