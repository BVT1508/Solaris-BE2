# Tiến độ phiên code Y

Cập nhật: 18/11/2026, khoảng 23:10. Phiên Y làm các gói Y1, Y2, Y3, Y4 theo `docs/kien-truc.md` mục 12. Cả bốn gói đã code xong, đã commit, `npm run lint` sạch.

## Kết quả

Bộ Postman của backend cũ (406 request, 1377 phép kiểm, không sửa gì), chạy bằng `qa-scripts/cf/chay-postman.js` với server của phiên Y ở `http://127.0.0.1:4002/api/v1`, D1 cục bộ trống (`.wrangler/state-y`), gồm cả phần của phiên X đã commit tới `b9d08c2`:

| Thư mục                                         | Request | Phép kiểm | Đạt  | Lỗi | Thiếu |
| ----------------------------------------------- | ------- | --------- | ---- | --- | ----- |
| 01 Auth                                         | 7       | 29        | 29   | 0   | 0     |
| 02 Thành viên                                   | 20      | 74        | 74   | 0   | 0     |
| 03 Đơn hàng                                     | 52      | 169       | 169  | 0   | 0     |
| 04 Sản phẩm bàn giao                            | 48      | 162       | 162  | 0   | 0     |
| 05 Link chia sẻ                                 | 41      | 143       | 143  | 0   | 0     |
| 06 Góp ý của khách                              | 46      | 157       | 157  | 0   | 0     |
| 07 Vòng review                                  | 119     | 409       | 409  | 0   | 0     |
| 08 Lỗi chung                                    | 3       | 12        | 12   | 0   | 0     |
| 09 Bảo mật                                      | 4       | 17        | 17   | 0   | 0     |
| 10 Thử upload ảnh                               | 10      | 30        | 30   | 0   | 0     |
| 11 Bàn giao, mở lại đơn và luật mới             | 24      | 73        | 73   | 0   | 0     |
| 12 Leader theo đơn                              | 20      | 65        | 65   | 0   | 0     |
| 13 Góp ý trên site web, phần tử và ảnh đính sau | 12      | 37        | 37   | 0   | 0     |
| Cộng                                            | 406     | 1377      | 1377 | 0   | 0     |

- Báo cáo: `qa-scripts/cf/ket-qua/2026-11-18_230142_y4-du-bo.md` (kèm `.json`, `.txt`).
- Chạy lượt hai trên cùng dữ liệu: 1376 đạt, trượt đúng `03 / Staff không còn đơn nào` (nhận 2 thay vì 0). Backend cũ cũng trượt đúng phép này khi chạy lại trên cùng database (`qa-scripts/cf/phu-thuoc.md` mục 6), nên đây là hành vi của bộ Postman, không phải lỗi của backend mới.
- Log của `wrangler dev` suốt các lượt chạy: không có dòng mức `error`, không có mã 5xx.
- Các gói của phiên Y phủ thư mục 03, 05, 07, 11, 12 và phần đường của mình trong các thư mục khác.

## Đã làm, theo gói

| Gói | Commit    | File                                                                                                                                                                                                                                                                         |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Y1  | `8f01469` | `routes/clientRoutes.js`, `routes/orderRoutes.js`, `controllers/clientController.js`, `controllers/orderController.js`, `services/clientService.js`, `services/orderService.js`, `validators/clientValidator.js`, `validators/orderValidator.js`                             |
| Y2  | `8187393` | `routes/activityRoutes.js`, `controllers/activityController.js`, `services/activityService.js`, `validators/activityValidator.js`                                                                                                                                            |
| Y3  | `5b2682f` | `middleware/guestMiddleware.js`, `routes/shareLinkRoutes.js`, `routes/publicRoutes.js`, `controllers/shareLinkController.js`, `services/shareLinkService.js`, `validators/shareLinkValidator.js`, và phần đầu của `services/roundService.js` (`toPublicRound`, `snapshotOf`) |
| Y4  | `1c1e178` | `routes/roundRoutes.js`, `routes/publicRoutes.js` (thêm `submit`, `approve`), `controllers/roundController.js`, `services/roundService.js`, `services/maintenanceService.js`, `validators/roundValidator.js`, `jobs/maintenanceJobs.js`                                      |

Không sửa file dùng chung nào, không sửa file của phiên X.

`guestMiddleware.js` xuất `resolveGuest` và `requireDevice` đúng như mục 12 mô tả; `c.get("guest")` là `{ link, deliverable, round, order, orderStatus, deviceHash, actor }`. `link` và `deliverable` mang đủ cột (kể cả `token`, `sdkKey`): nơi dùng không được trả nguyên ra API.

## Đã thử gì

Ngoài bộ Postman, có bốn kịch bản thử trực tiếp ở `qa-scripts/cf/` (không nằm trong repo):

| Kịch bản      | Kết quả     | Thử gì                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thu-y1.js`   | 85 phép đạt | Khách hàng và đơn hàng khi chưa có gói thành viên (thành viên thử chèn thẳng vào D1 của phiên Y): hình dạng JSON, lời báo, tìm không dấu, lọc tag, con trỏ, team và leader, quyền của leader và nhân viên, người bị gỡ mất quyền ngay, `member.orders` phản chiếu, bàn giao và mở lại, số dòng nhật ký từng loại, `tx_guard` trống. Chạy trước khi X1 có; giờ Postman 03 đã phủ. |
| `thu-y2.js`   | 16 phép đạt | Hoạt động của đơn trên dữ liệu Postman 03 để lại: phong bì, thứ tự, con trỏ, lọc theo nhóm và người làm, câu chữ đổi team.                                                                                                                                                                                                                                                       |
| `thu-y34.js`  | 47 phép đạt | Bấm cùng lúc: hai link đầu (cả hai 201, chỉ một vòng 1), hai khách gửi (một 200, một 409 "vòng đã khép"), hai lần mở vòng kế (một 201, một 409), hai khách duyệt (một 200, một 409). Nhật ký gửi ghi đúng số nháp. Lượt mở link đếm ngay. Đơn đã mở lại thì mở được vòng mới trên sản phẩm đã duyệt. Thu hồi link trả 404 cho khách. Câu chữ của hoạt động. `tx_guard` trống.    |
| `y-server.js` | công cụ     | Tắt và làm trống server thử của phiên Y (chỉ đụng `.wrangler/state-y` và tiến trình có `state-y` trong dòng lệnh).                                                                                                                                                                                                                                                               |

## Chưa thử

- **Việc dọn bản cũ của đơn đã bàn giao** (`purgeDeliveredVersions`, cron `41 */6 * * *`): chưa chạy lần nào. Lý do: trên máy dev chỉ gọi được cả nhóm cron 6 giờ, mà nhóm đó còn có việc dọn file tạm của gói X2 (`purgeStalePending`), việc ấy xóa file trên tài khoản Cloudinary thật. Phiên Y không tự kích. Cần phiên điều phối hoặc phiên X quyết cách thử (ví dụ tạm bỏ việc kia khỏi nhóm khi thử, và nhớ luật cũ: khi thử phải truyền `orderId`).
- **Báo trực tiếp**: `notifyFeedback` loại `submitted`, `approved`, `round`; `disconnectLink` khi thu hồi; `disconnectMember` khi gỡ khỏi team. Code có gọi, chưa nghe bằng WebSocket thật.
- **Ảnh trang khi vòng đã khóa với `force`**, và lưu nhiều ảnh trang một lần (xem điểm lệch 6). Postman 07 phủ các ca thường (lưu, giữ ảnh cũ bằng id, xóa bộ ảnh, trang không thuộc vòng).
- **Hai người lưu bộ ảnh trang cùng lúc** (guard `pages_rev`), **gỡ file cùng lúc với mở vòng** (guard `version` của sản phẩm), **đơn bị bàn giao giữa lúc đọc và lúc ghi**: guard đã đặt, chưa dựng được tình huống đụng nhau thật.
- **Giới hạn `guestWriteLimiter`** trên `submit`, `approve`: máy dev không áp.
- Mọi thứ trên Cloudflare thật: 10 ms CPU, D1 thật, trần 50 lời gọi ra ngoài.
- Các kịch bản cũ ở `qa-scripts/*.js` (`t1` đến `t9`, `be_kiem_*`): chưa chạy với backend mới; xem `qa-scripts/cf/kiem-ke-kich-ban.md`.

## Điểm lệch so với thiết kế và so với bản cũ

1. **Lượt mở link (`openByToken`) ghi ngay trong request, không dùng `runAfterResponse`.** Bảng ở mục 4 ghi "chạy bằng `runAfterResponse`". Bản cũ chờ câu ghi xong rồi mới trả lời, và `05 / Lượt mở link được đếm` đọc `openCount` ngay request kế tiếp; ghi sau response thì có thể đọc trước khi ghi. Lỗi ghi vẫn chỉ vào log, không chặn khách. Tốn thêm một lượt đi về tới D1 cho mỗi lần khách mở link.
2. **Guard "thành viên vẫn gán được" chặt hơn bảng** (#6, #8): ngoài cùng tổ chức, không bị khóa, không phải admin, còn khẳng định vai trò của từng người vẫn như lúc đọc. Luật leader ("người chỉ xem không làm leader", "leader không thêm được quản lý") quyết định dựa vào vai trò, nên vai trò đổi giữa chừng thì lô chạy lại và ra đúng lời báo.
3. **`createShareLink` có thêm guard "sản phẩm còn hoạt động" khi link không mở vòng.** Bảng chỉ ghi guard `version` cho trường hợp mở vòng 1. Không có guard này thì tạo được link trên sản phẩm vừa bị lưu trữ giữa lúc đọc và lúc ghi.
4. **Tìm đơn theo tên khách** dùng JOIN với `clients.name_search` thay cho "tìm tối đa 200 khách rồi lọc đơn" của bản cũ. Kết quả như nhau khi dưới 200 khách khớp; trên 200 thì bản mới đủ hơn.
5. **Nhật ký `before` của `order.update`, `client.update`, `shareLink.update`** có cả khóa mang giá trị `null`. Bản cũ bỏ khóa mà document chưa từng có. Câu chữ ở "Hoạt động" chỉ đọc `after` nên không đổi.
6. **Lưu ảnh trang gọi kho 2 lần mỗi ảnh mới** (hỏi rồi chuyển key), như `adoptScreenshot` của gói X3. Mục 8 muốn 1 lần (dùng luôn kết quả của `rename`) để 30 trang không vượt trần 50 lời gọi ra ngoài mỗi request. Driver hiện tại (`promote`) không trả kết quả của `rename`, và driver là file của phiên X. Hệ quả trên Cloudflare thật: một lần lưu quá 25 ảnh trang mới sẽ lỗi. Máy dev không có trần này nên Postman không lộ. **Cần phiên X**: cho `promote` trả `bytes`, `format`, `width`, `height`; khi có, `adoptPageShot` trong `roundService.js` đổi lại trong vài dòng.
7. **`purgeDeliveredVersions`**: mỗi đơn một lô, đầu lô có guard "đơn vẫn `delivered` và chưa dọn" và guard `version` cho từng sản phẩm bị sửa `files`; guard sai thì bỏ qua đơn đó tới lượt sau. Không gọi kho, 5 đơn mỗi lượt (đúng mục 7). Không tăng `version` của sản phẩm, như bản cũ.
8. **`refreshCurrentRound`** tính "file còn được giữ" bằng JavaScript từ một lượt đọc (file của các vòng khác, file có góp ý ghim), không gọi `isRetained` từng file. Guard đầu lô đúng như dòng #25.
9. **`setCurrentPages`** dùng `transact` với `retries: 0`: guard `status` và `pages_rev` sai thì trả 409 ngay và đưa ảnh vừa nhận vào thùng rác, không chạy lại (ảnh đã nhận gắn với lần đọc đó). Đúng ý bảng "ghi có điều kiện".
10. **Chi tiết đơn (`GET /orders/:id`) trả `client` gồm `id, name, contacts, source, tags, notes: null`**, không có `version`, `createdAt`, `updatedAt`. Đây là đúng thứ bản cũ trả (populate chỉ bốn trường rồi qua `toPublicClient`), giữ nguyên.
11. `roundValidator.js` import `ratio`, `size`, `pendingKeySchema` từ `feedbackValidator.js` của phiên X (đã `export`). `shareLinkValidator.js` và `roundValidator.js` tự khai `deliverableIdParams` để không phụ thuộc `deliverableValidator.js`.

Không có chỗ nào đổi đường dẫn, mã trạng thái hay lời báo so với bản cũ.

## Điều cần phiên X hoặc phiên điều phối

- Điểm lệch 6: `promote` của driver Cloudinary trả kết quả của `rename`.
- Cách thử việc dọn bản cũ mà không kích việc dọn file tạm trên Cloudinary thật.
- Chưa có gì cần sửa ở file dùng chung.

## Cách chạy lại

Từ thư mục `Solaris CF`:

```
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state-y
npx wrangler dev --port 4002 --persist-to .wrangler/state-y --inspector-port 9232
```

Từ `qa-scripts/cf`:

```
node chay-postman.js --base-url http://127.0.0.1:4002/api/v1
node thu-y34.js
node y-server.js tat
node y-server.js lam-trong --khong-bat      tắt, xóa .wrangler/state-y, áp lại migration; sau đó tự bật server
```

Bẫy đã gặp:

- `y-server.js bat` (bật tách rời bằng Node) không lên được trên máy Windows này: wrangler dừng ở "Starting local server...". Bật bằng lệnh `npx wrangler dev ...` ở trên.
- Gọi `npx wrangler d1 execute ... --command "<SQL có dấu cách>"` qua `child_process` với `shell: true` làm vỡ câu SQL. Gọi thẳng `node node_modules/wrangler/bin/wrangler.js ...` thì không.
- `json_group_array(... ORDER BY ...)` và `INSERT ... SELECT ... FROM json_each(...) WHERE true ON CONFLICT ...` chạy được trên D1 cục bộ (dùng trong `orderService.js`).
- `localeCompare(b, "vi")` trong Worker sắp đúng thứ tự tiếng Việt (đã kiểm ở `thu-y1.js`).
