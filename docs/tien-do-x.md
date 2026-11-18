# Tiến độ phiên code X

Cập nhật: 18/11/2026 (khuya). Phiên X làm các gói X1 tới X4 theo `docs/kien-truc.md` mục 12 và giữ các file dùng chung. Phần nền ghi ở `docs/tien-do.md`.

## Bàn giao (đọc mục này trước nếu vừa mất context)

Cập nhật lần cuối: 18/11/2026, khoảng 23 giờ 30. Mục này đủ để phiên X làm tiếp mà không cần nhớ gì.

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

Các bước, theo thứ tự (đánh dấu khi xong):

1. [ ] Sửa địa chỉ deploy trong repo: `wrangler.jsonc` (`vars.CLIENT_ORIGINS` và chú thích đầu file), `docs/kien-truc.md` dòng "Một Worker", `docs/tien-do.md` dòng "Cấu hình deploy": đổi `solaris-feedback` thành `solaris-fbs`.
2. [ ] Tách cấu hình deploy khỏi cấu hình dev: KHÔNG đổi `database_id` giữ chỗ trong `wrangler.jsonc` (đổi là mọi server dev mất dữ liệu D1 cục bộ). Ý định: script `scripts/make-deploy-config.mjs` sinh `wrangler.deploy.jsonc` (không commit) từ `wrangler.jsonc` với id thật, deploy bằng `wrangler deploy -c wrangler.deploy.jsonc`.
3. [ ] Deploy một bản ĐO để tìm chỗ tốn CPU. Cách deploy được phép (theo phiên điều phối): `git archive <commit>` ra thư mục tạm, chép `frontend-dist` vào, trong bản tạm đổi `database_id` thành id thật và `CLIENT_ORIGINS` thành địa chỉ thật, `npm ci`, rồi `CI=true npx wrangler deploy --secrets-file <file chỉ có dòng OWNER_EMAIL lấy từ .dev.vars, không in ra>`. Không tạo tài nguyên nào khác, không xóa gì, không bật đăng nhập dev ở bản deploy. Bản đo chỉ khác bản commit ở một route chẩn đoán thêm trong thư mục tạm (đường dẫn có mã ngẫu nhiên), chạy lặp từng thứ nghi ngờ: băm `node:crypto`, một truy vấn D1, ba truy vấn nối tiếp so với một lô ba câu, lời gọi Rate Limiting binding, zod, dựng JSON lớn, ký URL Cloudinary, chuỗi middleware. Đo bằng `npx wrangler tail app --format json` chạy nền trong lúc gửi request, xong thì tắt tiến trình tail.
4. [ ] Giảm theo kết quả đo. Nghi phạm: mỗi lượt đi về tới D1 tốn CPU (gom đọc bằng `readAll`, ghi bằng lô); bộ định tuyến Hono dựng ở request đầu; `ensureOwner` ở request lạnh; hai app Hono lồng nhau (`src/index.js` gọi `app.fetch`); log mỗi request; 12 header bảo mật mỗi response.
5. [ ] Deploy lại bản đo, đo sau khi sửa; cuối cùng deploy bản sạch từ commit (không có route chẩn đoán).
6. [ ] Ghi số đo trước và sau vào `docs/kien-truc.md` mục 10, luật viết code giữ CPU thấp vào mục 11. Sửa file dùng chung thì commit riêng và nêu trong báo cáo cho phiên điều phối.

**Lệnh và cổng của tôi.** Server thử: `npx wrangler dev --port 4001 --persist-to .wrangler/state-x` (cổng 4000 và `.wrangler/state` để chấm tổng; 4002 và `state-y` của phiên Y). Làm trống: `powershell -ExecutionPolicy Bypass -File "D:\Work\New folder\qa-scripts\cf\x_server.ps1" reset`. Chấm: trong `qa-scripts\cf`, `node chay-postman.js --base-url http://127.0.0.1:4001/api/v1 [-t <thư mục>] --nhan x-<nhãn>`. Kịch bản riêng: `x_kiem_gop_y_team.mjs` (68 phép), `x_kiem_kho_that.mjs` (18, Cloudinary thật), `x_doi_chieu_cloudinary.mjs` (30), `x_do_rename_cloudinary.mjs`. Commit: `git add <file mới>` rồi `git commit -m "<lời>" -- <đường dẫn>` để không cuốn theo file phiên Y đang sửa.

**Bẫy đã gặp trong đợt X** (thêm vào các bẫy ở `docs/tien-do.md`):

- Ghi file nguồn bằng công cụ ghi file, không qua heredoc của shell (vỡ cú pháp với nháy lồng).
- `wrangler dev` nạp lại khi phiên Y lưu file: request đang chạy nhận 503 "Your worker restarted mid-request". Khi chấm, đếm dòng `Reloading local server` trong `.wrangler/dev-x.log`; khác 0 thì chạy lại.
- `npm run lint` có thể đỏ vì file phiên Y đang viết dở; lint riêng file của mình bằng `npx eslint <đường dẫn>`.
- Prettier phải chạy trên file của mình trước khi commit (`npx prettier --write <đường dẫn>`).
- Đẩy file thẳng lên Cloudinary từ kịch bản đôi khi hết giờ kết nối; chạy lại là qua.
- Log của chính `wrangler dev` in nguyên đường dẫn có token của link (chỉ trên máy dev).

**Tin của phiên điều phối chưa làm xong:** chỉ còn việc giảm CPU ở trên. Việc còn mở cho phiên Y (đã ghi ở mục "Điểm lệch"): `adoptPageShot` nên đổi sang `storage.adoptPending`.

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
