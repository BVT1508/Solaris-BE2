import { emptyTrash, purgeStalePending } from "../services/storageService.js";

/**
 * Gói X2: việc định kỳ của kho file. Mỗi phần tử là [tên việc, hàm async trả kết quả để ghi log].
 *   hourlyJobs     dọn thùng rác kho file (bảng storage_trash), mỗi lượt tối đa 100 file
 *   sixHourlyJobs  dọn file tạm quá 1 ngày trên kho
 */
export const hourlyJobs = [
  ["dọn thùng rác kho file", async () => ({ deleted: await emptyTrash(100) })],
];

export const sixHourlyJobs = [
  [
    "dọn file tạm trên kho",
    async () => ({ deleted: await purgeStalePending() }),
  ],
];
