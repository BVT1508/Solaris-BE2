# Solaris CF

Backend của Solaris chạy trên Cloudflare Workers. Solaris là hệ thống của một agency: nhận đơn, làm sản phẩm bàn giao, khách mở link không cần tài khoản để ghim góp ý theo vòng, team chia việc sửa.

Repo này thay cho backend Express và MongoDB cũ (`Solaris BE`) mà **không đổi hợp đồng API**: đường dẫn, mã trạng thái, hình dạng JSON và lời báo lỗi giữ nguyên, nên frontend (`Solaris FE`) dùng lại được.

## Gồm những gì

Một Worker duy nhất (tên `app`) lo cả ba việc:

| Việc                            | Bằng gì                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| API `/api/v1/*`                 | Hono, JavaScript ES modules, kiểm dữ liệu bằng zod                     |
| Database                        | D1 (SQLite); lược đồ ở `migrations/0001_init.sql`                      |
| Kết nối trực tiếp của màn góp ý | một Durable Object giữ WebSocket (`src/realtime/`), `/api/v1/realtime` |
| Việc định kỳ                    | Cron Triggers (`src/jobs/`)                                            |
| Kho file                        | Cloudinary, gọi thẳng qua HTTP                                         |
| Bản build của frontend          | static assets trong `frontend-dist/`                                   |

Chi tiết thiết kế: [docs/kien-truc.md](docs/kien-truc.md). Giao thức WebSocket: [docs/hop-dong-realtime.md](docs/hop-dong-realtime.md). Trạng thái và bẫy đã biết: [docs/tien-do.md](docs/tien-do.md).

## Chạy trên máy dev

Cần Node 22.13 trở lên.

```
npm install
```

Sao chép `.dev.vars.example` thành `.dev.vars` rồi điền (file này không commit). Tối thiểu: `ENVIRONMENT=development`, `OWNER_EMAIL`, `CLIENT_ORIGINS`. Bỏ trống phần Google thì dùng đăng nhập dev; bỏ trống `CLOUDINARY_URL` thì các API về file trả 503, phần còn lại vẫn chạy.

```
npm run dev
```

Lệnh này tự áp migration vào D1 cục bộ rồi chạy `wrangler dev` ở `http://127.0.0.1:4000`.

| Lệnh                    | Làm gì                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `npm run db:migrate`    | áp migration vào D1 cục bộ                                                                    |
| `npm run db:reset`      | làm trống D1 cục bộ (tắt server trước); không bao giờ đụng D1 thật                            |
| `npm run sync-frontend` | chép bản build của `Solaris FE` (`npm run build` ở repo đó trước) vào `frontend-dist/`        |
| `npm run warmup:record` | ghi lại bản làm nóng `src/warmup/fixture.js` sau khi sửa truy vấn của một đường được làm nóng |
| `npm run warmup:check`  | kiểm bản làm nóng còn khớp với code (chạy trước khi deploy)                                   |
| `npm run lint`          | ESLint                                                                                        |
| `npm run format`        | Prettier                                                                                      |

Kích việc định kỳ trên máy dev: `curl "http://127.0.0.1:4000/cdn-cgi/local/scheduled?cron=23+*+*+*+*"` (theo giờ), hoặc chỉ một việc theo tên: `?cron=job:<từ khóa không dấu>`.

## Chấm

Thước đo là bộ Postman của backend cũ (`Solaris BE/postman`, 406 request, 1377 phép kiểm) chạy với server ở cổng 4000 trên D1 trống. Công cụ chạy và số gốc nằm ngoài repo, ở `qa-scripts/cf/` (đọc `README.md` ở đó):

```
node chay-postman.js --base-url http://127.0.0.1:4000/api/v1
```

Repo không có test tự động và không seed dữ liệu mẫu; kịch bản thử viết tay cũng để ở `qa-scripts/cf/`.

## Deploy

Việc deploy do chủ dự án (hoặc phiên được giao) làm, sau khi `wrangler login`.

1. **D1.** Tạo database một lần (`npx wrangler d1 create solaris`) và ghi lại id. `database_id` trong `wrangler.jsonc` là mã giữ chỗ và phải giữ nguyên (Wrangler đặt tên file D1 cục bộ theo mã này). Sinh cấu hình deploy riêng, không commit:

   ```
   node scripts/make-deploy-config.mjs --d1 <id của D1 thật> --origin https://<worker>.<tên con>.workers.dev
   ```

2. **Migration** lên D1 thật: `npx wrangler d1 migrations apply DB --remote -c wrangler.deploy.jsonc`.
3. **Khóa bí mật**, mỗi khóa một lệnh `npx wrangler secret put <TÊN> -c wrangler.deploy.jsonc`: `OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CLOUDINARY_URL`, và tùy chọn `RESEND_API_KEY` (email cảnh báo hạn mức, xem mục cuối). Ý nghĩa từng khóa ghi ở `.dev.vars.example`. Giá trị thường (`ENVIRONMENT`, `CLIENT_ORIGINS`) nằm ở `vars` của cấu hình.
4. **Google.** Ở Google Cloud Console, OAuth client loại Web, thêm Authorized redirect URI: `<origin của Worker>/api/v1/auth/google/callback`. Origin này phải trùng origin đầu tiên của `CLIENT_ORIGINS`.
5. **Frontend.** `npm run sync-frontend` để bản build mới nhất nằm trong `frontend-dist/`.
6. **Deploy:** `npx wrangler deploy -c wrangler.deploy.jsonc`.

Xem log và thời gian CPU của bản đang chạy: `npx wrangler tail app --format json`.

## Giới hạn gói miễn phí

Hệ thống được viết để chạy trong gói miễn phí của Cloudflare:

| Giới hạn                                         | Ghi chú                                 |
| ------------------------------------------------ | --------------------------------------- |
| 10 ms CPU mỗi request (thời gian chờ không tính) | số đo bên dưới                          |
| 100.000 request Worker mỗi ngày                  | file tĩnh có thật không tính            |
| 50 lời gọi ra ngoài, 50 truy vấn D1 mỗi request  | một lô (`batch`) tính là một truy vấn   |
| D1: 100.000 dòng ghi, 5 triệu dòng đọc mỗi ngày  | vượt thì mọi truy vấn lỗi tới 0 giờ UTC |
| Durable Object: 100.000 request mỗi ngày         | kết nối đang ngủ không tốn              |

Số đo `cpuTime` trên Cloudflare thật (19/11/2026):

| Request                                  | CPU (ms)               |
| ---------------------------------------- | ---------------------- |
| Request thường (vài truy vấn, JSON nhỏ)  | 1 tới 5                |
| Một lượt đi về tới D1                    | khoảng 0,5             |
| Danh sách 200 góp ý                      | trung vị 5, cao nhất 9 |
| Danh sách 500 góp ý (trần của danh sách) | trung vị 7, p90 13     |
| Kiểm một nét vẽ 2.000 điểm               | dưới 0,1               |

Bảng đầy đủ, cách đo và các luật viết code để giữ CPU thấp: [docs/kien-truc.md](docs/kien-truc.md) mục 10 và 11.

## Hạn mức gói miễn phí và cảnh báo

**Gói miễn phí không bao giờ tính tiền.** Chạm trần thì không bị trừ tiền mà bị ngừng phục vụ tới 00:00 UTC (07:00 giờ Việt Nam), lúc Cloudflare đặt lại hạn mức ngày:

| Trần mỗi ngày (tính theo tài khoản Cloudflare) | Chạm trần thì                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 100.000 request vào Worker                     | Cloudflare chặn request trước khi tới Worker (trang lỗi 1027): API và đăng nhập ngừng chạy |
| 100.000 dòng D1 ghi                            | mọi truy vấn D1 lỗi: API trả 500, không đăng nhập, không lưu được gì                       |
| 5.000.000 dòng D1 đọc                          | như trên                                                                                   |

Cloudflare không báo trước khi sắp chạm trần, nên hệ thống tự đếm và báo sớm.

**Xem mức dùng.** Quản trị viên gọi `GET /api/v1/usage` (màn quản trị của frontend hiển thị): ba chỉ số trên, số đã dùng trong ngày, phần trăm của trần, và mức `ok`, `warning` (từ 70%), `critical` (từ 90%). Hình dạng response: [docs/api-bo-sung.md](docs/api-bo-sung.md).

**Số này là ước lượng**, thường thấp hơn số thật của Cloudflare:

- Chỉ đếm Worker này và database của nó. Hạn mức của Cloudflare tính chung cho cả tài khoản: bản thử (`app-thu`), lệnh `wrangler d1 execute`, việc áp migration và thao tác trên trang quản trị Cloudflare ăn chung hạn mức mà không nằm trong số đếm.
- Số đếm nằm trong bộ nhớ khoảng 15 giây rồi mới ghi xuống database (một dòng ghi cho mọi request trong khoảng đó, để việc đếm gần như không tốn hạn mức). Phần chưa kịp ghi mất khi Cloudflare tắt tiến trình.

Số chính xác xem ở trang quản trị Cloudflare (Workers & Pages, và D1).

**Email cảnh báo.** Khi một chỉ số lần đầu trong ngày vượt 70% hoặc 90%, hệ thống ghi nhận (bảng `usage_alerts`) và gửi một email tới `OWNER_EMAIL`; mỗi chỉ số, mỗi ngưỡng, mỗi ngày đúng một lần. Việc kiểm chạy ngay sau mỗi lần ghi số đếm và trong việc định kỳ mỗi giờ; gửi lỗi thì giờ sau thử lại.

Email gửi qua [Resend](https://resend.com) (gói miễn phí: 100 email mỗi ngày, 3.000 mỗi tháng). Worker trên địa chỉ `workers.dev` không có tên miền nên không dùng được cách gửi email của chính Cloudflare. Bật email:

1. Đăng ký Resend bằng **đúng địa chỉ `OWNER_EMAIL`**. Chưa có tên miền thì Resend chỉ cho gửi từ `onboarding@resend.dev` tới email của chính tài khoản Resend, nên hai địa chỉ phải trùng nhau.
2. Tạo một API key ở Resend, rồi đặt làm khóa bí mật: `npx wrangler secret put RESEND_API_KEY -c wrangler.deploy.jsonc`.

Nếu tài khoản Resend đăng ký bằng một email khác `OWNER_EMAIL`, đặt thêm khóa `ALERT_EMAIL_TO` bằng đúng email của tài khoản Resend (`npx wrangler secret put ALERT_EMAIL_TO --name app`): email cảnh báo sẽ gửi tới địa chỉ đó thay cho `OWNER_EMAIL`.

Chưa đặt `RESEND_API_KEY` thì hệ thống vẫn đếm, vẫn ghi nhận ngưỡng đã vượt và `GET /api/v1/usage` vẫn dùng được; chỉ không có email. Đặt khóa sau thì ngưỡng đã vượt trong ngày mà chưa báo sẽ được gửi ở lượt kiểm kế tiếp. Sau này có tên miền riêng đã xác minh ở Resend thì đặt `ALERT_EMAIL_FROM` để đổi người gửi.

Trần dùng để tính phần trăm đặt ở `vars` của `wrangler.jsonc` (`USAGE_LIMIT_REQUESTS`, `USAGE_LIMIT_ROWS_READ`, `USAGE_LIMIT_ROWS_WRITTEN`): đổi khi Cloudflare đổi hạn mức hoặc khi nâng gói. Bảng đếm tạo bằng migration `0002_usage.sql`; chưa áp migration này thì hệ thống chạy bình thường nhưng không đếm.
