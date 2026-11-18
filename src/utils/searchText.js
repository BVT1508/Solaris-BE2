import { sql } from "../db/d1.js";

/**
 * Tìm kiếm không phân biệt hoa thường và không phân biệt dấu tiếng Việt ("da nang" ra "Đà Nẵng").
 *
 * Backend cũ dựng biểu thức chính quy cho MongoDB. SQLite không có hàm bỏ dấu, nên ở đây lưu sẵn một cột
 * đã bỏ dấu (search_text, name_search, title_search) mỗi khi ghi, và lúc tìm thì bỏ dấu từ khóa rồi so.
 * Kết quả giống cách cũ: cả từ khóa lẫn dữ liệu đều được đưa về chữ thường không dấu trước khi so.
 */
const normalize = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    // Bỏ ký tự điều khiển.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "");

/** Giá trị cho cột tìm kiếm: các phần (tên, email, số điện thoại...) đã bỏ dấu, cách nhau bằng xuống dòng. */
export const toSearchText = (...parts) =>
  parts
    .flat()
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map(normalize)
    .join("\n");

/**
 * Điều kiện "cột chứa từ khóa" cho câu WHERE; từ khóa đi qua tham số ràng buộc.
 *   where.push(matches(sql.raw("search_text"), query.search));
 * Dùng instr chứ không dùng LIKE: D1 giới hạn mẫu LIKE ở 50 byte, và instr không có ký tự đại diện phải thoát.
 */
export const matches = (column, keyword) =>
  sql`instr(${column}, ${normalize(keyword)}) > 0`;
