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
// - bridge.js và thư viện chụp ảnh (trong assets/) được site của khách nạp từ tên miền khác.
writeFileSync(
  join(target, "_headers"),
  [
    // Ứng dụng nội bộ: không cho công cụ tìm kiếm lập chỉ mục bất cứ trang nào.
    "/*",
    "  X-Robots-Tag: noindex, nofollow",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    // Thư viện chụp ảnh nằm trong assets/ và được bridge chèn vào site của khách (khác origin).
    "  Cross-Origin-Resource-Policy: cross-origin",
    "",
    "/bridge.js",
    "  Cross-Origin-Resource-Policy: cross-origin",
    "",
  ].join("\n")
);

// robots.txt cấm thu thập toàn bộ: bộ thu thập tử tế sẽ không quét (bot xấu thì bỏ qua file này). Là file tĩnh nên
// Cloudflare tự trả, không gọi Worker. Ghi đè nếu bản build của frontend có sẵn file cùng tên.
writeFileSync(join(target, "robots.txt"), "User-agent: *\nDisallow: /\n");

console.log(`Đã chép ${source} vào frontend-dist.`);
