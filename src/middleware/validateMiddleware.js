import AppError from "../utils/appError.js";

/**
 * Kiểm dữ liệu vào bằng schema zod. Dùng ở route:
 *   route.post("/", validate({ body: createOrderSchema }), orderCtrl.createOrder);
 * Sau khi qua, controller lấy dữ liệu đã kiểm ở c.get("valid"): { params, query, body }.
 * Nên dùng z.object(...).strict() để từ chối trường lạ như role: "admin".
 *
 * Lời báo cho người dùng luôn là tiếng Việt. Schema nào có lời báo riêng thì dùng lời đó;
 * lời mặc định của zod (tiếng Anh, toàn ký tự ASCII) thì đổi thành câu chung kèm tên trường.
 */
function toMessage(issue) {
  if (!issue) return "Dữ liệu không hợp lệ.";
  if (issue.code === "unrecognized_keys") {
    return `Trường không được nhận: ${issue.keys.join(", ")}.`;
  }
  // eslint-disable-next-line no-control-regex
  const isDefaultEnglish = /^[\x00-\x7F]*$/.test(issue.message || "");
  if (!isDefaultEnglish) return issue.message;
  const field = (issue.path || []).join(".");
  if (!field) return "Dữ liệu gửi lên không đúng định dạng.";
  return issue.code === "invalid_type"
    ? `Trường ${field} thiếu hoặc sai kiểu dữ liệu.`
    : `Trường ${field} không hợp lệ.`;
}

const validate =
  (schemas = {}) =>
  async (c, next) => {
    const input = {
      params: c.req.param(),
      query: c.req.query(),
      // Request không kèm body: coi là {} để lời báo là của schema (tiếng Việt), không phải "expected object".
      body: c.get("rawBody") === undefined ? {} : c.get("rawBody"),
    };
    // Route có nhiều lớp validate thì gộp kết quả.
    const valid = { ...(c.get("valid") || {}) };
    for (const part of ["params", "query", "body"]) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(input[part]);
      if (!result.success) {
        throw new AppError(toMessage(result.error.issues[0]), 400);
      }
      valid[part] = result.data;
    }
    c.set("valid", valid);
    await next();
  };

export default validate;
