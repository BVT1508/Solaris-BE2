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

**Gói miễn phí không bao giờ tính tiền.** Hạn mức tính theo ngày; chạm trần thì không bị trừ tiền mà bị ngừng phục vụ tới 00:00 UTC (07:00 giờ Việt Nam), lúc Cloudflare đặt lại:

| Trần mỗi ngày (tính theo tài khoản Cloudflare) | Nếu để chạm trần                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 100.000 request vào Worker                     | Cloudflare chặn request trước khi tới Worker (trang lỗi 1027): API và đăng nhập ngừng chạy |
| 100.000 dòng D1 ghi                            | mọi truy vấn D1 lỗi: không đăng nhập, không lưu được gì                                    |
| 5.000.000 dòng D1 đọc                          | như trên                                                                                   |

Cloudflare không báo trước khi sắp chạm trần. Hệ thống tự lo bốn việc: đếm, cảnh báo, tạm ngừng trước khi chạm trần, và không để bot làm hao request.

### Đếm và xem mức dùng

Quản trị viên xem ở mục "Quản lý hạ tầng" của giao diện (`GET /api/v1/infrastructure`: ba chỉ số của hôm nay, biểu đồ 48 giờ và 30 ngày, lưu lượng chia theo thành viên, khách và không danh tính, các cảnh báo đã gửi, các lớp bảo vệ đang bật) hoặc `GET /api/v1/usage`. Hợp đồng: [docs/api-bo-sung.md](docs/api-bo-sung.md).

**Số này là ước lượng**, thường thấp hơn số thật của Cloudflare:

- Chỉ đếm Worker này và database của nó. Hạn mức của Cloudflare tính chung cho cả tài khoản: bản thử (`app-thu`), lệnh `wrangler d1 execute`, việc áp migration và thao tác trên trang quản trị Cloudflare ăn chung hạn mức mà không nằm trong số đếm.
- Số đếm nằm trong bộ nhớ khoảng 15 giây rồi mới ghi xuống database (hai dòng ghi cho mọi request trong khoảng đó, để việc đếm gần như không tốn hạn mức). Phần chưa kịp ghi mất khi Cloudflare tắt tiến trình.

Số chính xác xem ở trang quản trị Cloudflare (Workers & Pages, và D1).

### Tạm ngừng khi sắp hết hạn mức

Khi một chỉ số đạt **97%** của trần (biến `USAGE_PAUSE_PERCENT`), hệ thống tự tạm ngừng tới 07:00 sáng hôm sau (giờ Việt Nam):

- Mọi lời gọi API trả 503 với mã `quota_paused`; giao diện hiện màn hình báo hết lưu lượng của hôm nay và giờ hoạt động lại, cho cả thành viên lẫn khách mở link.
- Quản trị viên vẫn đăng nhập và xem trang hạ tầng được (các đường đó nằm trong danh sách cho phép).
- Request bị chặn được trả lời trước khi đụng database, nên gần như không tốn gì.

Dừng ở 97% chứ không chờ 100% vì hai lý do: chừa phần cho quản trị viên vào xem, và để database không rơi vào trạng thái mọi truy vấn đều lỗi. Vì số đếm là ước lượng, còn một lớp nữa: khi chính D1 báo tài khoản đã chạm trần ngày, hệ thống cũng chuyển sang tạm ngừng và trả cùng thông báo thay cho lỗi 500.

Giới hạn cần biết: mỗi tiến trình của Worker chỉ biết số đếm sau lần ghi đầu tiên của nó, nên ngay sau lúc tạm ngừng vẫn có vài request lọt qua; và hạn mức **request** thì không tự cứu được hoàn toàn, vì request bị chặn vẫn là một request vào Worker.

### Chống bot làm hao request

Nói thẳng: Worker trên địa chỉ `workers.dev` **không có tường lửa (WAF)**. Request nào đã vào Worker là đã bị tính vào 100.000 request của ngày, dù Worker từ chối nó. Cách duy nhất không mất request là không để Worker chạy. Những gì đã làm:

| Lớp                                              | Tác dụng                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đường dẫn ngoài `/api` không gọi Worker          | Cloudflare tự trả file tĩnh, và trả `index.html` cho mọi đường khác, kể cả đường bot dò quét (`/wp-login.php`, `/.env`, `/xmlrpc.php`, đường ngẫu nhiên). **Không tính vào hạn mức request.**             |
| `robots.txt` cấm thu thập, header `X-Robots-Tag` | Bộ thu thập tử tế (Google, Bing...) không quét. Bot xấu thì bỏ qua file này.                                                                                                                              |
| Request chưa đăng nhập không đụng database       | Không có cookie phiên và không phải đường của link chia sẻ thì bị từ chối (401, 404) trước khi hỏi database: tốn một request nhưng không tốn dòng đọc, ghi.                                               |
| Giới hạn tần suất theo IP                        | 600 request API mỗi phút; 10 lần đăng nhập; 120 lần mở link chia sẻ; 60 lần ghi của khách. **Giảm tải cho database, không giảm số request bị tính**: request bị chặn (429) vẫn là một request vào Worker. |
| Tạm ngừng ở 97%                                  | Chặn mọi thứ trước khi database hết hạn mức.                                                                                                                                                              |

Trang hạ tầng tách lưu lượng thành ba loại (thành viên, khách, không danh tính) và đếm số 404, 429, 5xx theo giờ: cột "không danh tính" tăng vọt là dấu hiệu bot đang gõ vào `/api`.

Đánh đổi của lớp đầu tiên: một file không tồn tại (ví dụ gói JS cũ sau lần deploy) nhận `index.html` thay cho 404.

**Khuyến nghị (có phí, chưa làm):** muốn chặn bot TRƯỚC khi nó vào Worker thì cần một tên miền riêng đưa vào Cloudflare. Khi đó dùng được luật WAF, luật giới hạn tần suất ở biên và Bot Fight Mode của gói miễn phí, và tắt được địa chỉ `workers.dev`. Chi phí là tiền tên miền hằng năm; phần Cloudflare vẫn miễn phí.

### Email cảnh báo

Khi một chỉ số lần đầu trong ngày vượt 70%, 90%, hoặc ngưỡng tạm ngừng, hệ thống ghi nhận (bảng `usage_alerts`) và gửi một email tới `OWNER_EMAIL`; mỗi chỉ số, mỗi ngưỡng, mỗi ngày đúng một lần. Việc kiểm chạy ngay sau mỗi lần ghi số đếm và trong việc định kỳ mỗi giờ; gửi lỗi thì giờ sau thử lại.

Email gửi qua [Resend](https://resend.com) (gói miễn phí: 100 email mỗi ngày, 3.000 mỗi tháng). Worker trên địa chỉ `workers.dev` không có tên miền nên không dùng được cách gửi email của chính Cloudflare. Bật email:

1. Đăng ký Resend bằng **đúng địa chỉ `OWNER_EMAIL`**. Chưa có tên miền thì Resend chỉ cho gửi từ `onboarding@resend.dev` tới email của chính tài khoản Resend, nên hai địa chỉ phải trùng nhau.
2. Tạo một API key ở Resend, rồi đặt làm khóa bí mật: `npx wrangler secret put RESEND_API_KEY -c wrangler.deploy.jsonc`.

Nếu tài khoản Resend đăng ký bằng một email khác `OWNER_EMAIL`, đặt thêm khóa `ALERT_EMAIL_TO` bằng đúng email của tài khoản Resend (`npx wrangler secret put ALERT_EMAIL_TO -c wrangler.deploy.jsonc`).

Chưa đặt `RESEND_API_KEY` thì hệ thống vẫn đếm, vẫn ghi nhận ngưỡng đã vượt, vẫn tạm ngừng đúng lúc; chỉ không có email. Đặt khóa sau thì ngưỡng đã vượt trong ngày mà chưa báo sẽ được gửi ở lượt kiểm kế tiếp. Sau này có tên miền riêng đã xác minh ở Resend thì đặt `ALERT_EMAIL_FROM` để đổi người gửi.

### Cấu hình

Trần dùng để tính phần trăm đặt ở `vars` của `wrangler.jsonc` (`USAGE_LIMIT_REQUESTS`, `USAGE_LIMIT_ROWS_READ`, `USAGE_LIMIT_ROWS_WRITTEN`, `USAGE_PAUSE_PERCENT`): đổi khi Cloudflare đổi hạn mức hoặc khi nâng gói. Bảng đếm tạo bằng migration `0002_usage.sql` và `0003_usage_hourly.sql`; chưa áp thì hệ thống chạy bình thường nhưng không đếm (và vì vậy không tự tạm ngừng).
