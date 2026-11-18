// Sinh wrangler.deploy.jsonc (không commit) từ wrangler.jsonc cho bản deploy lên Cloudflare.
//
// Vì sao tách: `database_id` trong wrangler.jsonc là mã giữ chỗ. Wrangler đặt tên file D1 CỤC BỘ theo mã này, nên đổi nó
// trong wrangler.jsonc là mọi server dev đang chạy mất dữ liệu thử. File sinh ra chỉ khác ở mã D1 thật (và origin nếu truyền).
//
//   node scripts/make-deploy-config.mjs --d1 <id của D1 thật> [--origin https://<worker>.<tên con>.workers.dev]
//   npx wrangler deploy -c wrangler.deploy.jsonc
//
// Script chỉ ghi một file trên máy; không gọi Cloudflare.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const d1 = arg("--d1");
const origin = arg("--origin");

if (!d1 || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(d1)) {
  console.error("Thiếu hoặc sai --d1 <id của D1 thật> (dạng UUID).");
  process.exit(1);
}

let text = readFileSync(join(root, "wrangler.jsonc"), "utf8");
if (!text.includes(PLACEHOLDER)) {
  console.error(
    "wrangler.jsonc không còn mã D1 giữ chỗ: xem lại file trước khi deploy."
  );
  process.exit(1);
}
text = text.replace(PLACEHOLDER, d1);

if (origin) {
  const pattern = /("CLIENT_ORIGINS":\s*")[^"]*(")/;
  if (!pattern.test(text)) {
    console.error("Không thấy CLIENT_ORIGINS trong wrangler.jsonc.");
    process.exit(1);
  }
  text = text.replace(pattern, `$1${origin.replace(/\/$/, "")}$2`);
}

writeFileSync(
  join(root, "wrangler.deploy.jsonc"),
  `// FILE SINH TỰ ĐỘNG bởi scripts/make-deploy-config.mjs. Không sửa tay, không commit.\n${text}`
);
console.log(
  "Đã ghi wrangler.deploy.jsonc. Deploy: npx wrangler deploy -c wrangler.deploy.jsonc"
);
