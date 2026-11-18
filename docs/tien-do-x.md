# Tiến độ phiên code X

Cập nhật: 18/11/2026 (khuya). Phiên X làm các gói X1 tới X4 theo `docs/kien-truc.md` mục 12 và giữ các file dùng chung. Phần nền ghi ở `docs/tien-do.md`.

## Trạng thái các gói

| Gói | Nội dung                                        | Trạng thái                                  | Postman của gói (D1 trống, cổng 4001)                    |
| --- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| X1  | Thành viên                                      | xong                                        | 02: 20/20 request, 74/74 phép kiểm                       |
| X2  | Sản phẩm bàn giao, kho file Cloudinary qua HTTP | xong                                        | 04: 48/48, 162/162. 10 (upload thật): 10/10, 30/30       |
| X3  | Góp ý của khách                                 | xong                                        | 06: 46/46, 157/157. 13: 12/12, 37/37                     |
| X4  | Góp ý phía team                                 | xong phần code; chưa chấm được bằng Postman | 07 chạy sau bước "khách gửi góp ý" của gói Y4 (xem dưới) |

Lượt chạy cả bộ gần nhất (`ket-qua/2026-11-18_*_x-ca-bo`, D1 trống): 406/406 request chạy, 1257 phép kiểm đạt trên 1377. Đạt hết: 01, 02, 03, 04, 05, 06, 08, 09, 10, 13. Trượt: 07 (99 lỗi, 33 thiếu), 11 (7 thiếu), 12 (1 thiếu). Lúc chạy, các route của gói Y4 (`POST /r/:token/submit`, `/approve`, `POST /deliverables/:id/rounds`, ảnh trang) chưa có nên trả 404; mọi lỗi của 07 bắt đầu từ request "Khách gửi góp ý cho team" và lan xuống các request sau (thiếu biến, số thứ tự lệch 1 vì bước trước không chạy). Chưa có phép kiểm nào trượt được truy về code của gói X. Phải chạy lại 07, 11, 12 khi Y4 xong mới kết luận được phần team của X4.

## Đã thử ngoài Postman

Kịch bản để ở `D:\Work\New folder\qa-scripts\cf\` (tiền tố `x_`):

- `x_kiem_gop_y_team.mjs`: 68 phép kiểm, đạt cả 68. Gọi API thật trên cổng 4001, kèm ba kết nối WebSocket thật (hai tab team, một khách nối bằng token thật). Gồm: team tạo ghi chú và bài cho khách, gửi lại cùng `clientId`, lọc danh sách, giao việc, `version` cũ, người không gán được, việc của tôi, trả lời hai phía, khách tạo, sửa, xóa nháp, số thứ tự không cấp lại, kiểm khóa nhúng, xác nhận và từ chối, luật xóa, nhật ký hoạt động có đủ việc về góp ý. Về kết nối trực tiếp: khách nối bằng token thật; `feedback:event` tới team và khách; ghi chú nội bộ không tới khách; phía khách `actor` chỉ có `kind`; tab gây ra thay đổi không nhận lại sự kiện của mình (cả team lẫn khách).
- `x_doi_chieu_cloudinary.mjs`: so phần ký viết lại (`src/services/storage/cloudinarySign.js`) với SDK Cloudinary thật của backend cũ, khóa giả, không gọi mạng. 30 trường hợp (URL gốc bốn đuôi, ảnh nhỏ, ảnh trang PDF, chữ ký tham số upload, đổi tên, xóa), khớp cả 30.
- Upload ba bước với Cloudinary thật (Postman nhóm 10): xin chữ ký, đẩy thẳng lên Cloudinary, đính (hỏi kho, đổi tên), xem ảnh qua URL ký, gỡ file. Sau khi gỡ, bảng `storage_trash` về 0 dòng và log không có cảnh báo: xóa theo lô qua Admin API chạy được.
- Cron của kho gọi tay trên máy dev: dọn file tạm (0 file quá hạn), dọn thùng rác. Chạy không lỗi.
- `x_server.ps1`: tắt và làm trống server thử của phiên X (cổng 4001, `.wrangler/state-x`).

## Chưa thử

- Phần team của nhóm Postman 07, và 11, 12: chờ gói Y4.
- Ảnh chụp màn hình của khách với Cloudinary thật (`screenshotKey`, `PUT .../screenshot`): nhóm 13 qua nhưng cần đối chiếu xem nhóm đó có đẩy ảnh thật không; đường code dùng chung `statPending` và `promote` với upload file đã chạy thật.
- Hạn mức: 300 góp ý mỗi link mỗi vòng (429), 60 lần xin chỗ đẩy ảnh mỗi link trong 10 phút (máy dev nới gấp 10), luồng 200 trả lời.
- Đồng thời: hai request cùng `clientId` cùng lúc, tạo nháp đúng lúc vòng khép, hai người xử lý một bài. Guard đã có nhưng chưa bắn song song.
- PDF (sản phẩm `document`) với Cloudinary thật: số trang lấy từ `stat` có `pages=true`; Postman 04 có dùng PDF hay không chưa đối chiếu.
- Mọi thứ trên Cloudflare thật.

## Điểm lệch so với thiết kế, và quyết định khi làm

- **`rename` của Cloudinary không được dùng để lấy số đo.** Thiết kế (mục 8) đề xuất bỏ bước hỏi riêng. Gói X2 giữ hai lời gọi như bản cũ (hỏi rồi đổi tên) cho file và ảnh chụp của khách, vì cần biết loại và cỡ **trước** khi chuyển key. Với bộ ảnh trang 30 ảnh (gói Y4, `setCurrentPages`) thì hai lời gọi mỗi ảnh là 60, vượt trần 50 lời gọi ra ngoài của gói miễn phí: **việc này còn mở cho Y4**. `promote` hiện chưa trả thông tin file; nếu Y4 cần, phiên X thêm một hàm `promoteAndStat` vào `storageService.js`.
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
