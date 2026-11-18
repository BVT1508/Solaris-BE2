// Chép bản build của frontend (repo "Solaris FE", thư mục dist) vào frontend-dist để Worker phục vụ.
// Chạy `npm run build` ở repo frontend trước. Truyền đường dẫn khác: node scripts/sync-frontend.mjs <thư mục dist>.
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, process.argv[2] || "../Solaris FE/dist");
const target = join(root, "frontend-dist");

if (!existsSync(join(source, "index.html"))) {
  console.error(
    `Không thấy ${join(source, "index.html")}. Chạy "npm run build" ở repo frontend trước.`
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

// Header cho file tĩnh (Cloudflare đọc file _headers trong thư mục assets):
// - assets/ có mã băm trong tên nên giữ lâu; file khác (index.html, bridge.js, trang demo) Cloudflare mặc định luôn hỏi lại.
// - bridge.js được site của khách nạp từ tên miền khác.
writeFileSync(
  join(target, "_headers"),
  [
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/bridge.js",
    "  Cross-Origin-Resource-Policy: cross-origin",
    "",
  ].join("\n")
);

console.log(`Đã chép ${source} vào frontend-dist.`);
