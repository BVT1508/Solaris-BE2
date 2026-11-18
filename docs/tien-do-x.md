# Tiến độ phiên code X

Cập nhật: 18/11/2026 (khuya). Phiên X làm các gói X1 tới X4 theo `docs/kien-truc.md` mục 12 và giữ các file dùng chung. Phần nền ghi ở `docs/tien-do.md`.

## Bàn giao (đọc mục này trước nếu vừa mất context)

Cập nhật lần cuối: 19/11/2026, sáng. Mục này đủ để phiên X làm tiếp mà không cần nhớ gì.

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

**Tin của phiên điều phối chưa làm xong:** hai việc ưu tiên thấp của sáng 19/11 ở trên (xem mục "Đợt 19/11" để biết đã tới đâu). Việc deploy do phiên điều phối làm. Việc còn mở cho phiên Y: `adoptPageShot` nên đổi sang `storage.adoptPending`.

## Đợt 19/11

- [ ] Lỗi đóng WebSocket mã 4000 với kết nối chưa gửi lệnh nào: chưa xem.
- [ ] `README.md`: chưa viết.

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
