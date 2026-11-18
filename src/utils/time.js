/**
 * Thời gian lưu trong D1 là chuỗi ISO-8601 UTC có mili giây, ví dụ "2026-11-18T14:03:22.123Z":
 * đúng dạng JSON mà backend cũ trả (Date của Mongoose), nên đọc ra không phải đổi gì,
 * và so sánh chuỗi (<, >, ORDER BY) chính là so sánh thời gian.
 */
export const now = () => new Date().toISOString();

/** Mốc cách hiện tại `ms` mili giây (âm là quá khứ), dạng chuỗi ISO. */
export const fromNow = (ms) => new Date(Date.now() + ms).toISOString();

/** Đổi giá trị ngày đã qua validator (Date, chuỗi) sang chuỗi ISO để lưu; null và undefined giữ nguyên. */
export const toIso = (value) => {
  if (value === null || value === undefined) return value;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
};
