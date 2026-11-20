/**
 * Bộ đếm mức dùng trong bộ nhớ của isolate: số request vào Worker và số dòng D1 đã đọc, đã ghi kể từ lần ghi xuống gần nhất.
 * Chỉ là ba con số cộng dồn, không gọi database: lớp d1.js và điểm vào của Worker gọi vào đây ở mọi request mà không tốn gì.
 * Việc ghi xuống D1 theo lô nằm ở services/usageService.js (file này không import gì để d1.js dùng được mà không vòng).
 *
 * Isolate bị tắt thì phần chưa ghi xuống mất: số đếm là ước lượng, hơi thấp hơn thực tế.
 */
const zero = () => ({ requests: 0, rowsRead: 0, rowsWritten: 0 });

let pending = zero();

/** Một request vừa vào Worker. */
export const countRequest = () => {
  pending.requests += 1;
};

/** `meta` của một kết quả D1 (D1Result.meta): cộng số dòng câu đó đã đọc và đã ghi. */
export const countRows = (meta) => {
  if (!meta) return;
  pending.rowsRead += meta.rows_read || 0;
  pending.rowsWritten += meta.rows_written || 0;
};

/** Phần chưa ghi xuống (bản sao, chỉ để đọc). */
export const pendingUsage = () => ({ ...pending });

/** Lấy phần chưa ghi xuống và đặt bộ đếm về 0. */
export const takeUsage = () => {
  const taken = pending;
  pending = zero();
  return taken;
};

/** Trả lại phần đã lấy khi ghi xuống không thành, để lượt sau ghi tiếp. */
export const restoreUsage = (usage) => {
  pending.requests += usage.requests;
  pending.rowsRead += usage.rowsRead;
  pending.rowsWritten += usage.rowsWritten;
};
