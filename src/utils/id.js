/**
 * Mã định danh 24 ký tự hex chữ thường, cùng dạng với ObjectId của MongoDB để hợp đồng API không đổi.
 *
 * 12 ký tự đầu là thời điểm tạo: 8 ký tự giây (như ObjectId) cộng 4 ký tự phần lẻ của giây (1/65536 giây).
 * 12 ký tự sau ngẫu nhiên. Vì vậy sắp theo id là sắp theo thời gian tạo, và `ORDER BY id DESC` là "mới nhất trước":
 * phân trang con trỏ của backend cũ (con trỏ là id của bản ghi cuối trang) chạy nguyên.
 *
 * Trong Worker, Date.now() đứng yên giữa hai lần chờ I/O, nên nhiều id sinh liền nhau sẽ trùng mốc thời gian:
 * mốc luôn được đẩy lên ít nhất 1 so với id trước đó trong cùng isolate để thứ tự sinh được giữ nguyên.
 */
import { randomBytes } from "../config/runtime.js";

let lastStamp = 0;

const HEX = /^[0-9a-f]{24}$/;

export function newId() {
  const ms = Date.now();
  let stamp =
    Math.floor(ms / 1000) * 65536 + Math.floor(((ms % 1000) * 65536) / 1000);
  if (stamp <= lastStamp) stamp = lastStamp + 1;
  lastStamp = stamp;

  const random = randomBytes(6);
  let tail = "";
  for (const byte of random) tail += byte.toString(16).padStart(2, "0");
  return stamp.toString(16).padStart(12, "0") + tail;
}

/** true khi là id đúng dạng đã chuẩn hóa (chữ thường). Validator đổi id nhận vào sang chữ thường trước. */
export const isId = (value) => typeof value === "string" && HEX.test(value);
