# Tiến độ phiên code X

Cập nhật: 18/11/2026 (khuya). Phiên X làm các gói X1 tới X4 theo `docs/kien-truc.md` mục 12 và giữ các file dùng chung. Phần nền ghi ở `docs/tien-do.md`.

## Bàn giao (đọc mục này trước nếu vừa mất context)

Cập nhật lần cuối: 21/11/2026, sau đợt tạm ngừng và trang hạ tầng. Mục này đủ để phiên X làm tiếp mà không cần nhớ gì.

**Tôi là ai, làm gì.** Phiên X: giữ các file dùng chung (danh sách ở `docs/kien-truc.md` mục 12) và làm các gói X1 tới X4. Phiên Y (`local_34c8b246-b285-49df-9964-6fe03114c3a9`) làm Y1 tới Y4 trong cùng thư mục, cùng nhánh `main`. Phiên điều phối: `local_819fd873-aa60-4d35-8bf3-376b6cb0641d`.

**Đã xong, đã commit** (không push):

| Việc                                            | Commit                                               |
| ----------------------------------------------- | ---------------------------------------------------- |
| Khung, nền, lát đăng nhập, realtime, tài liệu   | `c0e9e58` tới `db3d17d`                              |
| X1 thành viên                                   | `1bdfab4`                                            |
| X2 sản phẩm, kho Cloudinary qua HTTP            | `394e0d3`, `a667d76` (nhận ảnh bằng một lời gọi kho) |
| X3, X4 góp ý khách và team                      | `0f9ad34`, `b9d08c2`                                 |
| Sửa nền theo bản soát (điểm 2, 11, 17, 18)      | `6030a59`                                            |
| Tài liệu theo bản soát và kết quả đo Cloudinary | `8a05c8e`, `b1e60c4`                                 |
| Ghi chú tiến độ                                 | `48717a6` tới commit chứa mục này                    |

Mọi điểm của `docs/soat-thiet-ke.md` giao cho X đã xử lý (bảng ở dưới). Cả bộ Postman: 406/406 request, 1377/1377 phép kiểm (lượt `x-chot-2`).

**Đang dở: giảm thời gian CPU** (phiên điều phối giao tối 18/11, ưu tiên cao). Bối cảnh: bản nền `db3d17d` đã được phiên điều phối deploy lên Cloudflare thật, Worker `app`, địa chỉ `https://app.solaris-fbs.workers.dev` (tên con là `solaris-fbs`, KHÔNG phải `solaris-feedback`), D1 `solaris` id `c7e83a5a-87eb-417f-9fd2-5a1d05833a11`. Số đo của phiên điều phối (`cpuTime` từ `wrangler tail app --format json`): `/auth/me` không cookie trung vị 1 ms nhưng request đầu của isolate mới 12 tới 19 ms; có cookie giả (một truy vấn D1) trung vị 5 ms, cao nhất 8 ms. Trần gói miễn phí là 10 ms.

**Số đo thật trên Cloudflare** (phiên điều phối đo bản `5ac2071` bằng bộ đo của X, `cpuTime` ms; phiên điều phối lo việc deploy, X chỉ dựng sẵn rồi nhắn):

- Đường thật: `/auth/me` không cookie trung vị 1, cao nhất 2; cookie giả trung vị 2, p90 5, cao nhất 10 (bản cũ trung vị 5); 404 qua app 0 tới 3; `index.html` 0 tới 1.
- D1: một truy vấn 0 tới 1; ba nối tiếp 1 tới 3; sáu nối tiếp 2 tới 4; lô ba câu 0 tới 2; lô sáu câu 1 tới 2. Một lượt đi về khoảng 0,5 ms. Đọc 500 dòng nhỏ: 1 tới 2.
- Binding: Rate Limiting 0 tới 1 cho cả 5 lời gọi; Durable Object 1 ms cho 3 lời gọi.
- Thuần JavaScript (1.000 lần): băm `node:crypto` 9; `crypto.subtle` 5; sinh id 1; ký URL 17. zod body thường 0,1 ms mỗi lần; **body có nét vẽ 2.000 điểm 5 ms mỗi lần**.
- **Danh sách lớn: dựng 500 object 12 tới 21 ms; dựng rồi in JSON 500 bài 18 tới 41 ms.** Máy của Cloudflare chậm hơn máy dev khoảng 3 tới 4 lần ở phần JavaScript thuần.
- Kết luận: request thường 2 tới 5 ms, ổn. Chỗ vượt 10 ms: danh sách vài trăm góp ý, và zod trên payload lớn.

Các bước phiên điều phối giao lúc nửa đêm 18/11, và trạng thái (cập nhật 19/11, rạng sáng):

1. [x] Địa chỉ deploy, tách cấu hình deploy (`d8e0943`), dựng bảng định tuyến lúc nạp module và `ensureOwner` chỉ ở đường đăng nhập (`f89a025`).
2. [x] **Danh sách góp ý: SQLite dựng JSON** (`201d3a8`). `TEAM_VIEW`, `guestViewSelect`, `finishView`, `joinViews` trong `feedbackService.js`; `mark`, `anchor` chuẩn hóa lúc ghi (`placementColumns`); trả lời lưu ở dạng của team cộng `deviceHash` (`newReply`); controller ghép phong bì bằng `c.body`. Bản một bài dùng chung câu SELECT rồi `JSON.parse`. Số đo Node ở `docs/kien-truc.md` mục 10: nhanh hơn 5 lần với bài thường, 12 lần với bài có nét vẽ. **500 bài nhiều khả năng vẫn vượt 10 ms trên Cloudflare** (ước 15 tới 20 ms): ngưỡng ước lượng 250 tới 300 bài; cần số đo thật (`viewsnew`, `viewsold` trong bộ đo) rồi phiên điều phối đưa chủ dự án quyết về trần 500.
3. [x] **Nét vẽ 2.000 điểm** kiểm bằng vòng lặp trước, zod sau (commit "validate stroke points..."), lời báo giữ nguyên (`x_kiem_net_ve.mjs`: 18/18). Ghim của bộ ảnh trang: phiên Y đã tự làm đường nhanh trong `roundValidator.js`, không cần đề xuất thêm.
4. [x] **Kích riêng một việc định kỳ trên máy dev** (`e238b74`): `curl "http://127.0.0.1:<cổng>/cdn-cgi/local/scheduled?cron=job:<từ khóa>"`, ví dụ `cron=job:ban+cu` chỉ chạy "dọn bản cũ của đơn đã bàn giao". Từ khóa không dấu, phải khớp đúng một tên việc; không khớp thì log liệt kê tên các việc. Chỉ có khi `ENVIRONMENT=development`.
5. [x] **Sự kiện trực tiếp của gói X qua WebSocket thật**: `x_kiem_gop_y_team.mjs` (68 phép) có tạo, trả lời, đổi trạng thái, xác nhận, xóa, loại trừ theo `X-Socket-Id`, khách không nhận sự kiện nội bộ; `x_kiem_kho_that.mjs` (24 phép) thêm sự kiện `submitted` và `status` khi ảnh đính vào bài đã gửi.
6. [x] Số đo thật và luật đã sửa trong `docs/kien-truc.md` mục 10 và 11.
7. [x] Phiên điều phối đã deploy bản đo `5810b35`, đo, rồi deploy lại bản sạch `671994b` (route chẩn đoán trả 404). Số thật (`cpuTime` ms): danh sách cách mới 50 bài trung vị 2; 100 bài 2; 200 bài 5 (cao nhất 9); **500 bài trung vị 7, p90 13**; cách cũ 500 bài trung vị 10, cao nhất 15; dựng bằng JavaScript 500 bài 25 tới 50; kiểm nét vẽ 2.000 điểm dưới 0,1 ms mỗi lần. Đã ghi vào `docs/kien-truc.md` mục 10. **Kết luận của phiên điều phối: không hạ trần 500, không hỏi chủ dự án về gói trả phí; việc giảm CPU xong.**

Việc phiên điều phối giao sáng 19/11 (ưu tiên thấp), trạng thái ghi ở mục "Đợt 19/11" bên dưới:

- Kết nối WebSocket chưa gửi lệnh nào bị ngắt bằng mã 4000 thì client của Node 22 kẹt ở `readyState` 2 (phiên Y báo ở `docs/tien-do-y.md` "Việc 3"; tái hiện bằng `node qa-scripts/cf/thu-ngat-ket-noi.js`). Xem `realtimeHub.js` có thiếu bước hoàn tất đóng không.
- Viết `README.md` cho repo.

File dùng chung đã sửa từ nửa đêm: `src/jobs/index.js` (kích riêng việc định kỳ), `docs/kien-truc.md`. Trước đó: `src/app.js`, `src/index.js`, `src/routes/authRoutes.js`, `src/controllers/authController.js`, `wrangler.jsonc`, `.gitignore`, `scripts/make-deploy-config.mjs`, `docs/tien-do.md`.

**Lệnh và cổng của tôi.** Server thử: `npx wrangler dev --port 4001 --persist-to .wrangler/state-x` (cổng 4000 và `.wrangler/state` để chấm tổng; 4002 và `state-y` của phiên Y). Làm trống: `powershell -ExecutionPolicy Bypass -File "D:\Work\New folder\qa-scripts\cf\x_server.ps1" reset`. Chấm: trong `qa-scripts\cf`, `node chay-postman.js --base-url http://127.0.0.1:4001/api/v1 [-t <thư mục>] --nhan x-<nhãn>`. Kịch bản riêng: `x_kiem_gop_y_team.mjs` (68 phép), `x_kiem_kho_that.mjs` (18, Cloudinary thật), `x_doi_chieu_cloudinary.mjs` (30), `x_do_rename_cloudinary.mjs`. Commit: `git add <file mới>` rồi `git commit -m "<lời>" -- <đường dẫn>` để không cuốn theo file phiên Y đang sửa.

**Bẫy đã gặp trong đợt X** (thêm vào các bẫy ở `docs/tien-do.md`):

- Ghi file nguồn bằng công cụ ghi file, không qua heredoc của shell (vỡ cú pháp với nháy lồng).
- `wrangler dev` nạp lại khi phiên Y lưu file: request đang chạy nhận 503 "Your worker restarted mid-request". Khi chấm, đếm dòng `Reloading local server` trong `.wrangler/dev-x.log`; khác 0 thì chạy lại.
- `npm run lint` có thể đỏ vì file phiên Y đang viết dở; lint riêng file của mình bằng `npx eslint <đường dẫn>`.
- Prettier phải chạy trên file của mình trước khi commit (`npx prettier --write <đường dẫn>`).
- Đẩy file thẳng lên Cloudinary từ kịch bản đôi khi hết giờ kết nối; chạy lại là qua.
- Log của chính `wrangler dev` in nguyên đường dẫn có token của link (chỉ trên máy dev).

**Tin của phiên điều phối chưa làm xong:** không còn. Việc mới nhất là đợt 21/11 (đếm mức dùng và cảnh báo), đã xong phần code và thử trên máy dev, chờ phiên điều phối áp migration `0002` và deploy; xem mục "Đợt 21/11". Việc deploy do phiên điều phối làm. Việc còn mở cho phiên Y: `adoptPageShot` nên đổi sang `storage.adoptPending`.

## Đợt 21/11 (sửa sau khi thử thật): tạm ngừng lọt giữa các tiến trình

Phiên điều phối thử `a5be6d2` trên bản thử: trang hạ tầng và lớp chống bot đạt 13/13 (40 lượt dò kiểu bot không gọi Worker, `robots.txt` đúng, dòng `warmup` báo 13/13). **Lỗi**: tạm ngừng chỉ có hiệu lực ở tiến trình đã tự biết số; 20 lần `GET /orders` tuần tự đều 200, 40 lần cùng lúc 23 lần 200, WebSocket vẫn nối được.

- [x] **Sửa**: bản chụp mức dùng có hạn dùng 15 giây (`USAGE_SNAPSHOT_SECONDS`). `refreshUsageIfStale` trong `usageService.js`; `pauseGate` (`quotaMiddleware.js`) và bắt tay WebSocket (`realtime/connect.js`) chờ đọc lại dòng của ngày khi isolate chưa biết gì về hôm nay hoặc bản chụp quá hạn. Độ trễ tối đa tới lúc mọi tiến trình cùng chặn: khoảng 30 giây. Chi phí: xấu nhất một dòng đọc mỗi request (dưới 2% hạn mức đọc). Không dùng chung promise giữa các request, không dùng Cache API.
- [x] Thử trên máy dev: `x_kiem_tam_ngung_tien_trinh.mjs` 5/5 (pha `ttl`) và 9/9 (pha `moi`); kết quả các kịch bản cũ và bộ Postman ghi ở dòng "Kết quả chạy lại" bên dưới.
- [x] **Làm nóng, việc còn nợ**: đã xem. Request mẫu đi đủ đường tạo góp ý của khách; phần còn lạnh là lần dùng đầu của các binding thật (lớp bọc D1, ba bộ giới hạn tần suất của đường khách, Durable Object, body, `Response`), không chạy được lúc nạp module. Số đo trên workerd cục bộ (`x-do-lanh/do-workerd.sh`) và kết quả của phiên điều phối đã ghi vào `docs/kien-truc.md` mục 10. Mục tiêu request thứ 1 dưới 6 ms **chưa đạt**; muốn đi tiếp phải đo từng binding trên Cloudflare thật bằng đường chẩn đoán.

- [x] **Nhãn môi trường trong email** (phiên điều phối giao thêm): biến `ENVIRONMENT_LABEL` (ví dụ `bản thử`), có giá trị thì tiêu đề thành "[Solaris, bản thử] ..." và dòng đầu thư ghi rõ không phải bản team đang dùng. Bản chính để trống.
- [x] **Đếm riêng request bị từ chối lúc tạm ngừng** (phiên điều phối giao thêm): migration `0004_usage_paused.sql` (cột `paused` ở `usage_hourly` và `usage_daily`); 503 `quota_paused` và kết nối trực tiếp mã 4503 không còn tính vào `status5xx`. Tên trường cho frontend: `hourly[].paused` và `daily[].paused` trong `GET /api/v1/infrastructure`.

Kết quả chạy lại sau mọi thay đổi của đợt này (máy dev, mỗi lượt một thư mục D1 mới): `x_kiem_tam_ngung_tien_trinh.mjs` 5/5 và 9/9; `x_kiem_tam_ngung.mjs` 35/35 (thêm phép P11 cho `paused`; với `ENVIRONMENT_LABEL` thì tiêu đề thư là "[Solaris, bản thử] ..."); cả bộ Postman 406 request 1377/1377 (`ket-qua/2026-11-21_025948_x-ban-chup-3`), server không nạp lại; `x_kiem_gop_y_team` 68/68; lint, prettier, `warmup:check` sạch. Một lượt Postman giữa chừng có 10 lỗi ở nhóm 07 vì server nạp lại 2 lần (phiên khác chép lại `frontend-dist` đúng lúc chấm): không tính, đã chạy lại. **Chưa thử trên Cloudflare thật.**

**Phiên điều phối cần làm khi deploy**: áp `0004_usage_paused.sql` lên cả hai D1 TRƯỚC khi deploy code (thiếu cột thì việc ghi số đếm tự nghỉ 10 phút một lần và `GET /infrastructure` lỗi); đặt `ENVIRONMENT_LABEL` cho Worker `app-thu`.

## Đợt 21/11 (tiếp nữa): tạm ngừng khi hết hạn mức, chống bot, trang hạ tầng

Yêu cầu của chủ dự án qua phiên điều phối (ưu tiên cao). Chi tiết thiết kế: `docs/kien-truc.md` mục 10, phần "Tạm ngừng, chống bot và trang hạ tầng"; hợp đồng cho frontend: `docs/api-bo-sung.md`; lời cho chủ dự án: `README.md` mục "Hạn mức gói miễn phí và cảnh báo".

- [x] **A. Tạm ngừng**: `src/middleware/quotaMiddleware.js` (cổng `pauseGate`, đứng trước `parseBody` trong `app.js`; `pausedResponse`), `isPaused` và `noteQuotaError` trong `usageService.js` (bản chụp trong bộ nhớ, không hỏi D1), `errorController.js` (D1 báo chạm trần thì trả cùng 503), `realtime/connect.js` (từ chối, mã đóng 4503, `code: "quota_paused"`). Biến `USAGE_PAUSE_PERCENT` (97). Ngưỡng tạm ngừng cũng là một ngưỡng cảnh báo có email.
- [x] **B. Chống bot**: `wrangler.jsonc` assets `not_found_handling: "single-page-application"` cộng `run_worker_first: ["/api", "/api/*"]`; `scripts/sync-frontend.mjs` sinh `robots.txt` và header `X-Robots-Tag`; phân loại `member`, `guest`, `anonymous` và đếm 404, 429, 5xx (`db/usageCounter.js`, `index.js`, `markMember` ở `protect` và ở kết nối trực tiếp). Không thêm bộ giới hạn riêng cho lưu lượng không danh tính (lý do ở mục 10).
- [x] **C. `GET /api/v1/infrastructure`**: `getInfrastructure` trong `usageService.js`, `usageController.js`, `usageRoutes.js` (`infrastructureRoutes`), migration `0003_usage_hourly.sql` (bảng `usage_hourly`, ba cột thêm vào `usage_daily`); việc định kỳ "dọn số đếm mức dùng cũ" (14 ngày theo giờ, 400 ngày theo ngày và cảnh báo). Mục `protection` có dòng `warmup` cho biết việc làm nóng có chạy trọn trên bản đang chạy không.
- [x] **D. Tài liệu**: `README.md`, `docs/api-bo-sung.md`, `docs/hop-dong-realtime.md` (mã 4503), `docs/kien-truc.md` (mục 1, 7, 10).

Đã thử, tất cả trên **máy dev** (`wrangler dev`, mỗi lượt một thư mục D1 mới, không xóa gì): `x_kiem_tam_ngung.mjs` 34/34 (quyền, hình dạng, 7 đường bot hay dò không gọi Worker, `robots.txt`, phân loại, tạm ngừng ở 97%, danh sách cho phép, kết nối trực tiếp 4503, request bị chặn không đụng D1, email báo tạm ngừng qua server giả); `x-do-lanh/thu-loi-tran-d1.mjs` 7/7 (D1 giả ném đúng lời lỗi chạm trần của Cloudflare); `x_kiem_muc_dung.mjs` 18/18 và 8/8 (nay chạy với `USAGE_PAUSE_PERCENT:100`); cả bộ Postman 406 request 1377/1377 (`ket-qua/2026-11-21_023325_x-tam-ngung`), server không nạp lại; `x_kiem_gop_y_team` 68/68; `cu/be_kiem_sua_nhanh.js` 32/32; lint, prettier, `warmup:check` sạch.

**Chưa thử trên Cloudflare thật**, và đây là những điểm cần phiên điều phối kiểm khi deploy bản thử:

1. Áp `0003_usage_hourly.sql` lên cả hai D1 TRƯỚC khi deploy code (thiếu thì không lỗi, nhưng không đếm và vì vậy không tự tạm ngừng).
2. Đường bot hay dò có gọi Worker không: tài liệu của Cloudflare không nhất quán, tôi chỉ xác nhận được trên workerd cục bộ. Cách kiểm: bắn `/wp-login.php`, `/.env`, một đường ngẫu nhiên (không kèm header trình duyệt) rồi xem `wrangler tail` có sự kiện nào không, hoặc xem số request ở `GET /infrastructure` có tăng không.
3. `robots.txt` chỉ có sau khi chạy lại `npm run sync-frontend` (file do script sinh, không nằm trong bản build của frontend).
4. Lời lỗi thật của D1 khi chạm trần ngày: tôi khớp theo chuỗi trong tài liệu ("free tier daily row read/write limit"), chưa thấy lỗi thật.
5. Dòng `warmup` trong `protection` của `GET /infrastructure`: nếu `active` là false trên bản thử thì việc làm nóng đang vấp một điều cấm chỉ có ở Cloudflare thật (giải thích được vì sao request thứ 1 không đổi và thời gian khởi động vẫn 54 ms).

File dùng chung đã sửa đợt này: `src/app.js`, `src/index.js`, `src/routes/index.js`, `src/controllers/errorController.js`, `src/controllers/authController.js` (một dòng `markMember`), `src/realtime/connect.js`, `src/config/env.js`, `src/middleware/frontendMiddleware.js` (chỉ chú thích), `wrangler.jsonc`, `.dev.vars.example`, `scripts/sync-frontend.mjs`, `scripts/prepare-dev.mjs`.

**Còn nợ** (phiên điều phối dặn làm sau việc này): xem 13 request mẫu của việc làm nóng có đi hết đường tạo góp ý của khách không (`POST /r/:token/feedback` là 8 trên 9 request còn vượt 10 ms), và phần nào chỉ chạy với binding thật.

## Đợt 21/11 (tiếp): giảm CPU vòng hai, làm nóng lúc nạp module

Phiên điều phối đo trên bản thử: request thứ 1 của một isolate tốn trung vị 9 ms (39% trên 10 ms), isolate ấm thì 3 tới 4 ms; 18 isolate cho 303 request. Việc giao: đưa chi phí lần dùng đầu ra khỏi request, vào lúc nạp module. Chi tiết và số đo: `docs/kien-truc.md` mục 10, phần "Chi phí lần dùng đầu".

- [x] **Tìm nguyên nhân**: bộ đo mới `qa-scripts/cf/x-do-lanh` (code thật của `src/` chạy trong Node, mỗi lượt một tiến trình, D1 là SQLite trong tiến trình; có `README.md`). Chi phí lần đầu rải đều cả đường xử lý, khoảng hai phần ba là phần dùng chung của mọi request; làm nóng riêng zod không đủ.
- [x] **Làm nóng**: `src/warmup.js` phát lại 13 request mẫu qua cả app lúc nạp module, chạy "khô": `src/config/runtime.js` (ngữ cảnh AsyncLocalStorage; `binding`, `waitUntil`, `randomBytes`), `src/warmup/dryRun.js` (database giả phát lại, `Response` không body), `src/warmup/fixture.js` (sinh tự động). Ghi lại bằng `npm run warmup:record` (`scripts/record-warmup.mjs`, `scripts/warmup/`); kiểm bằng `npm run warmup:check`.
- [x] Các chỗ chuyển sang đi qua `runtime.js`: `db/d1.js` (`db()`, không đếm lúc chạy khô), `middleware/rateLimitMiddleware.js`, `middleware/bodyMiddleware.js` (body lấy từ ngữ cảnh khi chạy khô), `utils/realtime.js`, `utils/background.js`, `utils/hash.js`, `utils/id.js`, `utils/logger.js` (im lặng khi chạy khô). Hành vi với request thật không đổi.
- [x] Điều Worker cấm lúc nạp module đã thử từng thứ trên workerd cục bộ (bảng ở mục 10): đáng nhớ nhất là KHÔNG tạo được `Response` hay `Request` có body, và `Date.now()` trả 0.

Kết quả, tất cả trên **máy dev**: bộ đo Node cho request đầu của tiến trình giảm 56% tới 75% (trung vị các đường 8,7 xuống 3,2 ms; ấm 0,6 tới 2,2); việc làm nóng thêm khoảng 25 ms lúc nạp module. Trên `wrangler dev` (workerd thật): 13 request mẫu đều khớp bản ghi, không vướng điều cấm; cả bộ Postman 406 request 1377/1377 (`ket-qua/2026-11-21_020709_x-lam-nong`), server không nạp lại; `x_kiem_gop_y_team` 68/68; số đếm mức dùng vẫn ghi; `npm run lint` và `npm run warmup:check` sạch. **Chưa đo trên Cloudflare thật**: `startup_time_ms` thật (ước 130 tới 190 ms, trần 1 giây) và `cpuTime` của request thứ 1 chờ phiên điều phối deploy bản thử và đo lại.

Bẫy mới: sửa code làm đổi truy vấn của một đường được làm nóng mà quên `npm run warmup:record` thì không lỗi gì, nhưng đường đó thôi được làm nóng (log khởi động có "Bản ghi làm nóng đã cũ"). `wrangler check startup` không chạy được vì Worker có Durable Object.

File dùng chung đã sửa đợt này: `src/index.js`, `src/db/d1.js`, `src/middleware/bodyMiddleware.js`, `src/middleware/rateLimitMiddleware.js`, `src/utils/{realtime,background,hash,id,logger}.js`, `package.json`.

## Đợt 21/11: đếm mức dùng gói miễn phí và cảnh báo

Phiên điều phối giao theo yêu cầu của chủ dự án. Cách làm việc đã đổi (`CLAUDE.md`, commit `caf56fc`): thước đo là bản chạy thật trên Cloudflare; phiên điều phối lo deploy (bản chính `app`, bản thử `app-thu`), X chỉ commit rồi nhắn. **Không xóa D1 cục bộ nữa**: muốn dữ liệu trống thì dùng thư mục `--persist-to` mới (đợt này: `.wrangler/state-x-usage`, `-usage2`, `-usage3`); `x_server.ps1 reset` xóa `state-x` nên đừng dùng khi chưa hỏi.

- [x] Số CPU của bản thử (268 request, trung vị 4, p99 20) đã ghi vào `docs/kien-truc.md` mục 10.
- [x] **Đếm**: `migrations/0002_usage.sql` (bảng `usage_daily`, `usage_alerts`); `src/db/usageCounter.js` (ba con số trong bộ nhớ); `src/db/d1.js` cộng `meta.rows_read`, `meta.rows_written` của mọi kết quả (`first()` giờ chạy bằng `all()`); `src/index.js` cộng request và hẹn ghi; `src/services/usageService.js` ghi một câu UPSERT sau `USAGE_FLUSH_SECONDS` giây (mặc định 15) bằng `waitUntil`. Không thêm lượt đi về D1 nào trên đường của request.
- [x] **`GET /api/v1/usage`** chỉ quản trị viên, đúng hình dạng phiên điều phối đưa; hợp đồng ở `docs/api-bo-sung.md`.
- [x] **Cảnh báo**: ngưỡng 70% và 90%, kiểm ngay sau lần ghi số đếm và trong việc mỗi giờ "kiểm hạn mức gói miễn phí" (`src/jobs/usageJobs.js`); mỗi (ngày, chỉ số, ngưỡng) một dòng `usage_alerts`; email qua Resend (`src/services/mailService.js`) chỉ khi có `RESEND_API_KEY`, gửi lỗi thì giờ sau thử lại.
- [x] Cấu hình: `USAGE_LIMIT_REQUESTS`, `USAGE_LIMIT_ROWS_READ`, `USAGE_LIMIT_ROWS_WRITTEN` (ở `vars`), `USAGE_FLUSH_SECONDS`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`; riêng máy dev có `RESEND_API_URL` để trỏ sang server email giả.
- [x] Tài liệu: `README.md` mục "Hạn mức gói miễn phí và cảnh báo", `docs/kien-truc.md` mục 7, 9, 10, `docs/api-bo-sung.md`.

Đã thử, tất cả trên **máy dev**: `qa-scripts/cf/x_kiem_muc_dung.mjs` pha 1 18/18 (quyền, hình dạng, đếm, ngưỡng, ghi nhận khi chưa có khóa) và pha 2 8/8 (gửi lỗi 500 rồi gửi lại thành công, không gửi trùng, đúng dạng lời gọi Resend) với server email giả; cả bộ Postman trên D1 trống 406 request, 1377/1377 (`ket-qua/2026-11-21_011451_x-muc-dung`), server không nạp lại lần nào; `npm run lint` sạch; chưa áp migration thì request vẫn chạy và chỉ có một dòng cảnh báo trong log. **Chưa thử**: trên Cloudflare thật (hành vi `waitUntil` chờ 15 giây, số `meta` của D1 thật), và chưa gửi email thật qua Resend (chưa có khóa).

Số đo phụ từ lượt Postman đó (423 request): 4.928 dòng đọc, 1.204 dòng ghi, tức khoảng 12 dòng đọc và 3 dòng ghi mỗi request của bộ thử. Với tỷ lệ này, **trần chạm trước là 100.000 dòng ghi** (khoảng 35.000 request kiểu bộ thử), không phải 100.000 request.

Việc phiên điều phối cần làm: áp `0002_usage.sql` lên cả hai D1 TRƯỚC khi deploy code mới (thiếu bảng thì không lỗi nhưng không đếm), deploy bản thử, thử thật. Bật email: chủ dự án đăng ký Resend bằng đúng `OWNER_EMAIL`, tạo API key, đặt `RESEND_API_KEY` (xem README).

File dùng chung đã sửa đợt này: `src/db/d1.js`, `src/index.js`, `src/routes/index.js`, `src/jobs/index.js`, `src/config/env.js`, `src/realtime/realtimeHub.js` (thêm một dòng ghi số đếm trong `alarm`), `wrangler.jsonc`, `.dev.vars.example`.

## Đợt 19/11

- [x] **Lỗi đóng WebSocket mã 4000 với kết nối chưa gửi lệnh nào: đã xem, không phải lỗi của `realtimeHub.js`, không sửa.** Tái hiện được bằng `thu-ngat-ket-noi.js` ở cổng 4001. Dò bằng socket thô (`qa-scripts/cf/x_do_dong_ws.mjs`): khung đóng mã 4000 tới client ở mọi trường hợp; client trả lời; `webSocketClose` ở hub chạy với mã 4000, `wasClean` đúng, `readyState` 3 ở cả bốn trường hợp. Khác nhau chỉ ở mức TCP: kết nối chưa gửi khung nào thì tầng `wrangler dev` không ngắt TCP sau bắt tay đóng (chờ 5 giây vẫn mở); đã gửi một khung, kể cả `ping` (thứ runtime tự trả, không vào code của hub), thì TCP ngắt sau 20 ms. Vì `ping` cũng chữa được nên nguyên nhân không nằm ở code của hub; tài liệu Cloudflare cũng ghi không cần gọi `close()` trong `webSocketClose` khi server đã đóng chiều gửi. Trình duyệt tự ngắt sau bắt tay đóng nên không bị; WebSocket của Node 22 chờ TCP nên kẹt. Cách tránh cho kịch bản Node: gửi `ping` ngay sau `ready`. Chưa thử trên Cloudflare thật. Đã ghi vào `docs/hop-dong-realtime.md` mục 8.
- [x] `README.md` ở gốc repo: hệ thống là gì, chạy máy dev, chấm, deploy (script sinh cấu hình, khóa bí mật, callback Google), giới hạn gói miễn phí và số đo CPU.
- [x] **`parseBody` trả 415 như bản cũ** (phiên Y tìm ra, phiên điều phối giao): body JSON có `charset` khác `utf-8` hoặc `Content-Encoding` khác `identity` nhận 415 "Kiểu nội dung gửi lên không được hỗ trợ.", trước khi đọc body, đúng thứ tự của body-parser 2.4 (`charset.unsupported` rồi `encoding.unsupported`), và chỉ khi request có khai body. Điểm khác đã biết, ghi ở `docs/kien-truc.md` mục 11: bản cũ giải nén được `gzip`, `deflate`, `br`, `zstd` và đọc được UTF-16, UTF-32, bản mới trả 415. File dùng chung đã sửa: `src/middleware/bodyMiddleware.js`. Kết quả thử (cổng 4001, D1 trống, server không nạp lại lần nào): cả bộ Postman 406 request, 1377/1377 phép kiểm (`ket-qua/2026-11-19_002904_x-415`); `cu/be_kiem_sua_nhanh.js` 32/32, gồm hai phép K1; thêm 11 tổ hợp header thử tay (`UTF-8`, `"utf-8"` có nháy, `Identity` vẫn nhận; `latin1`, `utf8`, `utf-16`, `foo`, `gzip` nhận 415).

## Trạng thái các gói

Cả bốn gói xong. Lượt chạy cả bộ chốt (`qa-scripts/cf/ket-qua/2026-11-18_*_x-chot-2`, D1 trống, server của phiên X ở cổng 4001, code trên đĩa lúc 23 giờ 18/11 gồm commit `b1e60c4` cộng các file phiên Y đang sửa dở, server không nạp lại lần nào trong lượt chạy): **406/406 request, 1377/1377 phép kiểm, 0 lỗi, 0 thiếu**, bằng đúng số gốc của backend cũ. Lượt ngay trước đó (`..._x-chot`) có một request nhận 503 "Your worker restarted mid-request" vì `wrangler dev` nạp lại code khi phiên Y lưu file giữa lượt chạy, kéo theo 5 phép kiểm trượt ở nhóm 07: không phải lỗi code. Khi chấm, đếm dòng `Reloading local server` trong log của server; khác 0 thì chạy lại.

| Gói | Nội dung                                        | Thư mục Postman chấm gói              | Kết quả                                      |
| --- | ----------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| X1  | Thành viên                                      | 02                                    | 20/20 request, 74/74 phép kiểm               |
| X2  | Sản phẩm bàn giao, kho file Cloudinary qua HTTP | 04; 10 (upload thật lên Cloudinary)   | 48/48, 162/162; 10/10, 30/30                 |
| X3  | Góp ý của khách                                 | 06; 13                                | 46/46, 157/157; 12/12, 37/37                 |
| X4  | Góp ý phía team                                 | 07 (chung với gói Y4); 11, 12 có dùng | 119/119, 409/409; 24/24, 73/73; 20/20, 65/65 |

Các thư mục còn lại trong cùng lượt: 01 (7/7, 29/29), 03 (52/52, 169/169), 05 (41/41, 143/143), 08 (3/3, 12/12), 09 (4/4, 17/17).

Lượt chạy cả bộ trước đó (`..._x-ca-bo`, lúc gói Y4 chưa có) trượt 07, 11, 12 vì các route gửi, duyệt, mở vòng trả 404; không phép kiểm nào trượt do code của gói X.

## Đã thử ngoài Postman

Kịch bản để ở `D:\Work\New folder\qa-scripts\cf\` (tiền tố `x_`):

- `x_kiem_gop_y_team.mjs`: 68 phép kiểm, đạt cả 68 (chạy lại sau khi gói Y4 vào, vẫn 68). Gọi API thật trên cổng 4001, kèm ba kết nối WebSocket thật (hai tab team, một khách nối bằng token thật). Gồm: team tạo ghi chú và bài cho khách, gửi lại cùng `clientId`, lọc danh sách, giao việc, `version` cũ, người không gán được, việc của tôi, trả lời hai phía, khách tạo, sửa, xóa nháp, số thứ tự không cấp lại, kiểm khóa nhúng, xác nhận và từ chối, luật xóa, nhật ký hoạt động có đủ việc về góp ý. Về kết nối trực tiếp: khách nối bằng token thật; `feedback:event` tới team và khách; ghi chú nội bộ không tới khách; phía khách `actor` chỉ có `kind`; tab gây ra thay đổi không nhận lại sự kiện của mình (cả team lẫn khách).
- `x_doi_chieu_cloudinary.mjs`: so phần ký viết lại (`src/services/storage/cloudinarySign.js`) với SDK Cloudinary thật của backend cũ, khóa giả, không gọi mạng. 30 trường hợp (URL gốc bốn đuôi, ảnh nhỏ, ảnh trang PDF, chữ ký tham số upload, đổi tên, xóa), khớp cả 30.
- Upload ba bước với Cloudinary thật (Postman nhóm 10): xin chữ ký, đẩy thẳng lên Cloudinary, đính (hỏi kho, đổi tên), xem ảnh qua URL ký, gỡ file. Sau khi gỡ, bảng `storage_trash` về 0 dòng và log không có cảnh báo: xóa theo lô qua Admin API chạy được.
- `x_kiem_kho_that.mjs`: 18 phép kiểm với Cloudinary thật, đạt cả 18. Ảnh chụp của khách: xin chỗ, đẩy thẳng, lưu góp ý trước rồi đính ảnh sau (kích thước do kho đo, `rect`, không tăng `version`), gọi lại an toàn, đường cũ gửi `screenshotKey` lúc tạo, key đã dùng thì 400, URL ký và ảnh nhỏ đọc được, xóa nháp có ảnh. PDF của sản phẩm `document`: xin chỗ, đẩy, đính (2 trang, 2 ảnh trang JPG đọc được), `version` cũ nhận 409 trước khi đụng kho, gỡ file chưa gửi khách thì xóa hẳn. Log không có lỗi kho.
- Cron của kho gọi tay trên máy dev: dọn file tạm (0 file quá hạn), dọn thùng rác. Chạy không lỗi.
- `x_server.ps1`: tắt và làm trống server thử của phiên X (cổng 4001, `.wrangler/state-x`).

## Chưa thử

- Hạn mức: 300 góp ý mỗi link mỗi vòng (429), 60 lần xin chỗ đẩy ảnh mỗi link trong 10 phút (máy dev nới gấp 10), luồng 200 trả lời.
- Đồng thời: hai request cùng `clientId` cùng lúc, tạo nháp đúng lúc vòng khép, hai người xử lý một bài. Guard đã có nhưng chưa bắn song song.
- Mọi thứ trên Cloudflare thật.

## Điểm lệch so với thiết kế, và quyết định khi làm

- **Nhận ảnh bằng một lời gọi kho.** Đã đo với Cloudinary thật (`x_do_rename_cloudinary.mjs`): `rename` trả loại, dung lượng, chiều rộng, chiều cao, và 404 khi file không có; với PDF không trả số trang. `storageService.adoptPending(keyTạm, keyChínhThức)` dùng điều đó; ảnh chụp của khách (`adoptScreenshot`) đã chuyển sang một lời gọi (thử lại với kho thật: 18/18). File của sản phẩm (ảnh, PDF) vẫn hỏi rồi chuyển, vì cần kiểm loại, cỡ và `version` trước khi đụng file, và PDF cần số trang. **Còn mở cho phiên Y:** `adoptPageShot` trong `roundService.js` vẫn gọi `statPending` rồi `promote` (2 lời gọi mỗi ảnh; 30 trang là 60, vượt trần 50 lời gọi ra ngoài của gói miễn phí). Đổi sang `adoptPending` là xong: đuôi của key chính thức lấy bằng `storage.extOfKey(keyTạm)`.
- **Xóa file**: mọi chỗ `removeQuietly` cũ thành `storage.trashStatement([...])` trong lô, kèm `storage.emptyTrashSoon()` sau lô; ngoài lô thì `storage.trashQuietly([...])`. `readUrl`, `thumbUrl`, `pageUrls` giờ đồng bộ (không cần `await`).
- **`toPublicDeliverable`, `toPublicFile`, `toPublicPages`, `activeFiles`, `isRetained`, `notRetainedGuards`, `loadRounds`, `findDeliverable`** xuất từ `deliverableService.js` cho phiên Y dùng.
- **Validator dùng chung cho ảnh trang**: `ratio`, `size`, `pageRect`, `pendingKeySchema` xuất từ `feedbackValidator.js`.
- **Thêm guard so với bảng mục 4** (theo bản soát): tạo nháp đếm lại trần 300 ngay trong lô; tạo góp ý có `target` thì khẳng định file còn tồn tại; khách xác nhận hay từ chối thì khẳng định vòng còn mở.

## Xử lý các điểm của `docs/soat-thiet-ke.md` giao cho X

| Điểm | Đã làm gì                                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Không** cho `updateMember`, `ensureOwner` tăng `orders.version`: bản cũ không tăng, và đơn đổi `version` khi vai trò một người đổi sẽ làm các request dùng `version` đã lưu nhận 409. Phiên Y đã chọn cách còn lại: `assignableGuard` so `(id, role, trạng thái)` của mọi thành viên liên quan ngay trong lô. Đã ghi ngoại lệ này vào `kien-truc.md` mục 3.2. |
| 2    | `transact`: chỉ bọc lô trong `try`, `done` chạy ngoài.                                                                                                                                                                                                                                                                                                          |
| 3    | `attachFile` làm ba pha (kiểm đủ trước khi đụng kho). Đã sửa chữ trong `kien-truc.md`.                                                                                                                                                                                                                                                                          |
| 5    | `deleteDraftByGuest`: lô có guard `status = 'draft'` mang nhãn; nháp vừa được gửi đi thì 409 và ảnh không vào thùng rác.                                                                                                                                                                                                                                        |
| 6    | Thêm guard "file đích còn tồn tại" cho tạo góp ý của khách (trong `rounds.files`) và của team (trong `deliverables.files`).                                                                                                                                                                                                                                     |
| 9    | Thêm trả lời không đổi dòng nào: đọc lại, bài không còn thì 404, còn thì "Luồng trao đổi này đã quá dài.". `attachScreenshotByGuest` đã trả 404 khi nháp vừa bị xóa.                                                                                                                                                                                            |
| 10   | Hai luật cho guard ghi vào `kien-truc.md` mục 3.2 và đầu hàm `transact`.                                                                                                                                                                                                                                                                                        |
| 11   | Thêm `id` phá hòa: `listMembers`, `listDevLoginMembers`, `listMine`.                                                                                                                                                                                                                                                                                            |
| 12   | Ghi nhận trong `kien-truc.md` mục 11.                                                                                                                                                                                                                                                                                                                           |
| 13   | Chốt: bộ đếm số thứ tự không đổi `updated_at` của sản phẩm; kiểm khóa nhúng và lượt mở link thì có. Ghi trong `kien-truc.md` mục 3.2.                                                                                                                                                                                                                           |
| 14   | `target.fileId`, `replacesFileId`, `assigneeId`, `deliverableId` trong body và query đều qua `objectIdSchema`.                                                                                                                                                                                                                                                  |
| 17   | `Object.hasOwn` cho bảng lỗi; `plan` trả `undefined` không vỡ; câu cần đọc kết quả đặt ở vị trí cố định (cuối lô) khi số guard thay đổi.                                                                                                                                                                                                                        |
| 18   | `ensureOwner` có guard "chủ vẫn chưa được khôi phục": bên chạy sau dừng, không tăng `version` và không ghi nhật ký lần hai.                                                                                                                                                                                                                                     |
| 19   | Đã thêm ba guard (xem mục trên). `setCurrentPages` thuộc Y4.                                                                                                                                                                                                                                                                                                    |
| 20   | Ghi vào `kien-truc.md` mục 3.2. Code của X tự đặt `id`, `createdAt` cho file và trả lời.                                                                                                                                                                                                                                                                        |
| 21   | `createDeliverable` kiểm trong `plan` với đúng lời "Đơn đã bàn giao. Mở lại đơn trước khi thêm sản phẩm."; guard trong lô không nhãn nên chạy lại ra đúng lời đó.                                                                                                                                                                                               |

## File dùng chung đã sửa trong đợt này

- `src/db/d1.js`: điểm 2, 17. Chữ ký hàm không đổi.
- `src/services/authService.js`: điểm 11, 18.
- `docs/kien-truc.md`: các điểm 1, 3, 10, 12, 13, 20.

## Cách chạy của phiên X

```
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state-x
npx wrangler dev --port 4001 --persist-to .wrangler/state-x
```

Làm trống: `powershell -ExecutionPolicy Bypass -File "D:\Work\New folder\qa-scripts\cf\x_server.ps1" reset` rồi khởi động lại. Chấm: trong `qa-scripts\cf`, `node chay-postman.js --base-url http://127.0.0.1:4001/api/v1 -t <thư mục> --nhan x-<gói>`.
