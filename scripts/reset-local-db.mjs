// Làm trống D1 CỤC BỘ rồi dựng lại bảng từ thư mục migrations. Dùng trước mỗi lần chấm bằng bộ Postman
// (bộ Postman chỉ cho kết quả chuẩn trên database trống).
//
// Chỉ đụng tới file của D1 cục bộ trong .wrangler/state trên máy này: script xóa thư mục đó bằng lệnh của hệ điều hành
// và áp migration với cờ --local viết cứng. Không có nhánh nào gọi tới D1 thật trên Cloudflare, có truyền tham số gì cũng vậy.
//
// Phải TẮT `wrangler dev` trước: server đang chạy giữ file database (Windows báo file đang bận).
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localD1 = join(root, ".wrangler", "state", "v3", "d1");

if (process.argv.length > 2) {
  console.error(
    "Script này không nhận tham số: nó chỉ làm trống D1 cục bộ của repo."
  );
  process.exit(1);
}

if (existsSync(localD1)) {
  try {
    rmSync(localD1, { recursive: true, force: true });
  } catch (err) {
    if (["EBUSY", "EPERM", "ENOTEMPTY"].includes(err.code)) {
      console.error(
        "Không xóa được D1 cục bộ vì file đang bận. Tắt `wrangler dev` (npm run dev) rồi chạy lại."
      );
      process.exit(1);
    }
    throw err;
  }
  console.log("Đã xóa D1 cục bộ (.wrangler/state/v3/d1).");
} else {
  console.log("Chưa có D1 cục bộ, tạo mới.");
}

execSync("npx wrangler d1 migrations apply DB --local", {
  cwd: root,
  stdio: "inherit",
});
console.log(
  "D1 cục bộ đã trống và đủ bảng. Chủ hệ thống được tạo lại ở request đầu tiên vào /api/v1/auth."
);
