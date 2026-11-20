// Chạy trước `npm run dev`: bảo đảm thư mục bản build frontend tồn tại và D1 cục bộ đã có đủ bảng.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "frontend-dist");

// Wrangler không chạy nếu thư mục assets không có. Chưa build frontend thì đặt một trang giữ chỗ.
if (!existsSync(join(dist, "index.html"))) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>Solaris</title>' +
      "<p>Chưa có bản build của frontend. Chạy <code>npm run sync-frontend</code>.</p>\n"
  );
  writeFileSync(join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
  console.log("Đã tạo frontend-dist/index.html giữ chỗ.");
}

if (!existsSync(join(root, ".dev.vars"))) {
  console.warn(
    "Chưa có .dev.vars: sao chép .dev.vars.example thành .dev.vars rồi điền OWNER_EMAIL."
  );
}

// Áp các migration còn thiếu vào D1 cục bộ (.wrangler/state). Chạy lại nhiều lần không sao.
execSync("npx wrangler d1 migrations apply DB --local", {
  cwd: root,
  stdio: "inherit",
});
