import { waitUntil } from "../config/runtime.js";
import logger from "./logger.js";

/**
 * Chạy một việc sau khi đã trả lời người dùng (báo trực tiếp, dọn file thừa trên kho): Worker giữ request sống tới khi xong.
 * Lỗi chỉ ghi log, không làm hỏng thao tác đã lưu. Truyền hàm async, không truyền promise đã chạy.
 */
export const runAfterResponse = (task, label = "việc nền") => {
  waitUntil(
    Promise.resolve()
      .then(task)
      .catch((err) => logger.warn({ err, label }, "Việc nền bị lỗi"))
  );
};
