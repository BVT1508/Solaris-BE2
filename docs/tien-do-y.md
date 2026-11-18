# Tiến độ phiên code Y

Cập nhật: 18/11/2026, khoảng 23:30. Phiên Y làm các gói Y1, Y2, Y3, Y4 theo `docs/kien-truc.md` mục 12. **Đọc mục "Bàn giao" ngay dưới trước**; các mục sau là chi tiết.

## Bàn giao (đọc phần này là làm tiếp được)

Viết cho chính phiên Y sau khi context bị nén, hoặc cho phiên khác nhận việc. Cập nhật lần cuối: 18/11/2026, 23:30.

### ĐANG LÀM (cập nhật 18/11/2026, khoảng 23:59): đợt việc thứ ba của phiên điều phối

Phiên điều phối giao năm việc, làm liên tục: (1) chạy các kịch bản cũ ở `qa-scripts/*.js` với backend mới, (2) kịch bản bắn đồng thời cho các lô có guard, (3) nghe báo trực tiếp bằng WebSocket thật, (4) thử `purgeDeliveredVersions` (CHỜ phiên X cho cách kích riêng từng việc định kỳ; không kích cả nhóm cron), (5) đo và giảm bước kiểm zod của `PUT .../rounds/current/pages`. Lỗi ở file của phiên X hoặc file dùng chung: báo phiên điều phối, không tự sửa. Lỗi ở file gói Y: sửa, chạy lại cả bộ Postman trên dữ liệu trống, commit.

Trạng thái từng việc lúc ghi:

| Việc             | Tới đâu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Còn lại                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Kịch bản cũ   | Thư viện chung `qa-scripts/cf/cu/lib-cf.js` (thay Mongo bằng `d1()`, thay `env.OWNER_EMAIL` bằng `ownerEmail()`, thay Socket.IO bằng `connectRealtime()`). Ba tác tử phụ chuyển 8 kịch bản sang `qa-scripts/cf/cu/`. Nhóm 1 (`be_kiem_tranh_chap` 4/4, `be_kiem_mo_lai_don` 15/15, `be_kiem_sua_nghiep_vu` 45/45) và nhóm 3 (`be_kiem_anh_gop_y` 22/22, `be_kiem_cong_cu_gop_y` 25/25) đã báo đạt hết, không có lỗi code mới. Nhóm 2 (`t1`, `t4_states_concurrency`, `be_kiem_leader`, `be_kiem_nhat_ky`) đang chạy. Kết quả từng nhóm: `qa-scripts/cf/cu/ket-qua-nhom-{1,2,3}.md`. | Chờ nhóm 2. Tự chạy lại cả 8 bản chép một lượt để kiểm lời báo của tác tử (`cd qa-scripts/cf/cu && node <tên>.js`). Ghi bảng kết quả vào mục "Đã thử gì".                          |
| 2. Bắn đồng thời | Đã viết `qa-scripts/cf/thu-dong-thoi.js` (năm loạt: `team`, `gui`, `vong`, `gopy`, `file`). CHƯA chạy lần nào.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Chạy `node thu-dong-thoi.js` khi các tác tử xong (tránh trần 600 request mỗi phút). Sửa kịch bản nếu nó sai, sửa code gói Y nếu lộ lỗi.                                            |
| 3. WebSocket     | `qa-scripts/cf/thu-realtime-y.js`: 25 trên 26 phép đạt. `submitted`, `round`, `approved` tới đúng team và khách; loại trừ theo `X-Socket-Id` đúng; khách không nhận tên hay id; gỡ khỏi team thì kết nối đóng mã 4000. **Một lỗi ở lớp dùng chung (xem dưới).**                                                                                                                                                                                                                                                                                                                     | Báo phiên điều phối lỗi đó trong báo cáo cuối lượt.                                                                                                                                |
| 4. Dọn bản cũ    | Chưa làm, đang chờ phiên X.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |                                                                                                                                                                                    |
| 5. Zod ảnh trang | Đo: payload lớn nhất (30 trang, 300 ghim mỗi trang, 531 KB) tốn zod khoảng 7 ms và `JSON.parse` khoảng 3 ms trên máy dev. Đã thêm đường kiểm nhanh viết tay vào `src/validators/roundValidator.js` (`fastRoundPages`; payload hợp lệ đi đường nhanh, còn lại giao cho zod nên lời báo lỗi không đổi). So 30.000 payload ngẫu nhiên với zod: không lệch (`qa-scripts/cf/so-kiem-nhanh-anh-trang.mjs`). Đo lại lúc máy đang bận: còn khoảng 2,4 ms (`qa-scripts/cf/do-zod-anh-trang.mjs`). **Thay đổi này CHƯA COMMIT.**                                                              | Đo lại lúc máy rảnh. Chạy cả bộ Postman trên dữ liệu trống rồi commit `src/validators/roundValidator.js` (lời commit gợi ý: "validate round pages with a hand written fast path"). |

**Lỗi tìm ra ở file dùng chung (phải báo phiên điều phối, không tự sửa):** `src/realtime/realtimeHub.js`. Kết nối WebSocket nào CHƯA TỪNG gửi lệnh nào (khách thì luôn như vậy, vì khách không cần gửi `deliverable:watch`) khi bị server ngắt (`disconnect(tag)`, mã 4000: thu hồi link, lưu trữ sản phẩm, đăng xuất) thì phía client kẹt ở trạng thái đang đóng (`readyState` 2) và KHÔNG nhận được sự kiện `close` kèm mã 4000 (đã chờ 10 giây, Node 22). Kết nối đã gửi ít nhất một lệnh (`deliverable:watch`) thì đóng đúng, mã 4000. Tái hiện: `node qa-scripts/cf/thu-ngat-ket-noi.js` (bốn trường hợp: khách chưa gửi tin, khách đã gửi tin, thành viên chưa gửi tin, thành viên đã gửi tin). Chỉ thử trên `wrangler dev` cục bộ; chưa biết Cloudflare thật có như vậy không. Hệ quả: khách đang mở link bị thu hồi không được báo link đã chết cho tới khi tự tải lại.

Việc phải làm ngay sau khi đọc lại mục này: (a) `git status --short` trong `Solaris CF`: file của tôi đang sửa dở chỉ có `src/validators/roundValidator.js`; (b) xem ba file `ket-qua-nhom-*.md`; (c) chạy `thu-dong-thoi.js`; (d) làm trống dữ liệu, chạy cả bộ Postman, commit; (e) cập nhật mục này và các mục "Đã thử gì", "Chưa thử".

### Đã xong và commit nào

| Việc                                                   | Commit                                                                  | Trạng thái                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Y1 khách hàng, đơn hàng                                | `8f01469`                                                               | xong, Postman 03 qua                                              |
| Y2 hoạt động của đơn                                   | `8187393`                                                               | xong, nằm trong Postman 12, qua                                   |
| Y3 link chia sẻ, `guestMiddleware.js`, `GET /r/:token` | `5b2682f`                                                               | xong, Postman 05 qua                                              |
| Y4 vòng review, ảnh trang, dọn bản cũ                  | `1c1e178`                                                               | xong, Postman 07, 11, 12 qua; riêng việc dọn bản cũ chưa chạy thử |
| Sửa theo bản soát thiết kế (điểm 1, 4, 7, 8, 11, 19)   | `092e946`                                                               | xong                                                              |
| Ảnh trang nhận bằng một lời gọi kho                    | commit ngay sau mục này ("adopt page shots with a single storage call") | xong                                                              |
| Ghi chú tiến độ                                        | `2f643b9`, `75d7006`, và commit của mục này                             |                                                                   |

Lần chạy đủ bộ gần nhất (sau mọi thay đổi trên, D1 trống, cổng 4002): 406 request, 1377 phép kiểm, 0 lỗi. Báo cáo: `qa-scripts/cf/ket-qua/2026-11-18_232006_y-anh-trang-1-loi-goi.md`. `npm run lint` sạch. Chưa push gì (luật: không push).

### Đang dở

Không có việc nào đang viết dở. Cây làm việc sạch sau commit của mục này (kiểm bằng `git status --short`; nếu thấy file `src/` đã sửa mà chưa commit thì đó là của phiên X, đừng đụng).

### Bước kế tiếp, theo thứ tự

1. **Thử `purgeDeliveredVersions`** (`src/services/maintenanceService.js`). Chưa chạy lần nào. Đang chờ phiên điều phối hoặc phiên X quyết cách thử, vì trên máy dev chỉ kích được cả nhóm cron `41 */6 * * *`, trong đó có `purgeStalePending` của gói X2 xóa file tạm trên tài khoản Cloudinary thật. Khi được phép: lùi `delivered_at` của MỘT đơn thử trong `.wrangler/state-y` quá 30 ngày bằng `wrangler d1 execute`, kích cron, rồi kiểm `versions_purged_at`, `deliverables.files`, `rounds.pages`, `storage_trash`. Luật cũ: khi thử phải giới hạn về một đơn.
2. **Nghe báo trực tiếp bằng WebSocket thật** cho các lời gọi của phiên Y: `notifyFeedback` loại `submitted`, `approved`, `round`; `disconnectLink` khi thu hồi; `disconnectMember` khi gỡ khỏi team. Cách nối: `docs/hop-dong-realtime.md`.
3. **Giảm CPU nếu số đo cho thấy cần**: mọi thao tác ghi đơn trong `orderService.js` đọc lại đơn sau lô (`readPublic`), 3 lượt tới D1 mỗi request. Chờ luật ở `kien-truc.md` mục 11 của phiên X rồi mới sửa.
4. **Ngày 3**: chạy các kịch bản cũ ở `qa-scripts/*.js` với backend mới (kiểm kê và việc phải đổi: `qa-scripts/cf/kiem-ke-kich-ban.md`).

### Lệnh chạy và cổng của phiên Y

- Server thử: cổng **4002**, inspector **9232**, dữ liệu riêng ở `.wrangler/state-y`, log ở `.wrangler/dev-y.log`. Không dùng cổng 4000, 4001; không đụng `.wrangler/state`, `.wrangler/state-x`; không chạy `npm run db:reset`.
- Bật (từ thư mục `Solaris CF`, chạy nền): `npx wrangler dev --port 4002 --persist-to .wrangler/state-y --inspector-port 9232`
- Tắt: `node y-server.js tat` (từ `qa-scripts/cf`). Làm trống dữ liệu: `node y-server.js lam-trong --khong-bat`, rồi bật lại bằng lệnh trên.
- Chấm: `node chay-postman.js --base-url http://127.0.0.1:4002/api/v1` (cả bộ), thêm `-t 07` cho một thư mục (tự kéo theo thư mục phụ thuộc), `--nhan <chữ>` để đặt tên báo cáo. Mỗi lượt đủ bộ phải bắt đầu từ dữ liệu trống.
- Kịch bản thử riêng (từ `qa-scripts/cf`): `node thu-y34.js` (link, vòng, bấm cùng lúc), `node thu-diem1.js` (điểm 1 của bản soát), `node thu-y2.js` (hoạt động, chạy sau Postman 03). `thu-y1.js` chỉ dùng khi chưa có gói thành viên.
- Commit: `git add <file mới>` rồi `git commit -m "<lời tiếng Anh, chữ thường, một dòng>" -m "Co-Authored-By: ..." -- <đường dẫn>`, chỉ file của phiên Y. Không push.

### Luật làm việc phải nhớ

- Chỉ sửa file của gói Y (bảng ở `kien-truc.md` mục 12) và `docs/tien-do-y.md`. File dùng chung và file của phiên X cần sửa thì nhắn phiên điều phối `local_819fd873-aa60-4d35-8bf3-376b6cb0641d`, không tự sửa.
- Không sửa `Solaris BE`, `Solaris FE`, bộ Postman. Không in khóa bí mật (`.dev.vars`, `.env`). Chỉ tắt tiến trình của mình.
- Kịch bản thử để ở `qa-scripts/cf/`, không để trong repo.

### Bẫy đã gặp

- `y-server.js bat` (bật tách rời bằng Node) không lên trên máy Windows này; bật bằng lệnh `npx wrangler dev ...` chạy nền.
- Lệnh tắt tác vụ nền báo "failed" cho tác vụ `wrangler dev` mỗi khi tôi tắt server bằng `y-server.js tat`: đó là do mình tắt, không phải lỗi.
- `wrangler d1 execute --command "<SQL>"` qua `child_process` với `shell: true` làm vỡ câu SQL; gọi thẳng `node node_modules/wrangler/bin/wrangler.js ...`.
- Heredoc của Git Bash vỡ khi nội dung có dấu backtick hoặc `${}`: viết script vá ra file rồi chạy.
- Bộ Postman chạy lần hai trên cùng dữ liệu trượt `03 / Staff không còn đơn nào` (cả backend cũ cũng vậy): không phải lỗi.
- Postman CLI in các `pm.sendRequest` là "[errored] Could not read response data." dù chúng thành công; `chay-postman.js` đã xử lý, đừng đọc tay rồi tưởng lỗi.
- Header HTTP không nhận chữ có dấu (`fetch` ném lỗi ByteString): giá trị thử cho `X-Device-Id` phải là ASCII.
- `chay-postman.js` mặc định cổng 4000: luôn nêu `--base-url` khi chấm server của mình.

### Điểm của `docs/soat-thiet-ke.md`

- **Đã xử lý:** 1 (phần #6 và #8), 4, 7, 8, 11, 19 (phần `setCurrentPages`). Chi tiết ở mục "Xử lý kết quả soát thiết kế".
- **Đã soát, không phải sửa:** 10, 14, 15, 20.
- **Không thuộc phiên Y:** 2, 3, 5, 6, 9, 12, 13, 17, 18, 21 (phiên X).
- **Còn mở:** điểm 4 mới sửa code, chưa chạy thử (bước kế tiếp số 1). Điểm 19, hai phần còn lại (trần 300 góp ý, `verdictByGuest`) nằm trong `feedbackService.js` của phiên X.

### Tin nhắn của phiên điều phối

| Tin                                                                                                        | Trạng thái                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Giao gói Y1 đến Y4                                                                                         | xong                                                                                                                                                               |
| Kết quả soát thiết kế, phần của Y                                                                          | xong, trừ việc thử điểm 4                                                                                                                                          |
| Tin CPU sát 10 ms: gom đọc bằng `readAll`, tránh đọc lại, không dựng schema trong request                  | đã bớt hai truy vấn (khách mở link, `listAssignableMembers`); việc đọc lại đơn sau lô còn giữ, xem bước kế tiếp số 3. Schema zod của phiên Y đều dựng ở cấp module |
| Phiên X quyết `updateMember` có tăng `version` của đơn không                                               | phiên X đã chốt là không (ghi ở `kien-truc.md` mục 3.2); code của phiên Y không phụ thuộc quyết định đó                                                            |
| Ghi mục bàn giao này và giữ nó cập nhật sau mỗi gói; context vượt khoảng 90% thì ghi xong rồi mới làm tiếp | đang làm theo                                                                                                                                                      |
| Đang chờ trả lời: cách thử việc dọn bản cũ mà không kích việc dọn file tạm trên Cloudinary thật            | chưa có trả lời                                                                                                                                                    |

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

1. **Lượt mở link (`openByToken`) ghi ngay trong request, không dùng `runAfterResponse`.** Bảng ở mục 4 ghi "chạy bằng `runAfterResponse`". Bản cũ chờ câu ghi xong rồi mới trả lời, và `05 / Lượt mở link được đếm` đọc `openCount` ngay request kế tiếp; ghi sau response thì có thể đọc trước khi ghi. Lỗi ghi vẫn chỉ vào log, không chặn khách. Câu ghi đặt cả `updated_at` như bản cũ (mục 11 của kiến trúc), không tăng `version`. Tên khách giờ lấy chung trong lượt đọc ngữ cảnh, nên một lần khách mở link còn 3 lượt tới D1 (ngữ cảnh, các vòng, ghi lượt mở), thêm 1 lượt khi có ghim trên ảnh trang.
2. **Guard của team chặt hơn bảng** (#6, #8), xem điểm 1 ở mục "Xử lý kết quả soát thiết kế".
3. **`createShareLink` luôn guard "sản phẩm còn hoạt động"**, kể cả khi link không mở vòng (điểm 7 của bản soát).
4. **Tìm đơn theo tên khách** dùng JOIN với `clients.name_search` thay cho "tìm tối đa 200 khách rồi lọc đơn" của bản cũ. Kết quả như nhau khi dưới 200 khách khớp; trên 200 thì bản mới đủ hơn.
5. **Nhật ký `before` của `order.update`, `client.update`, `shareLink.update`** có cả khóa mang giá trị `null`. Bản cũ bỏ khóa mà document chưa từng có. Câu chữ ở "Hoạt động" chỉ đọc `after` nên không đổi.
6. **Đã hết lệch (23:20):** lưu ảnh trang giờ gọi kho 1 lần mỗi ảnh mới. `adoptPageShot` dùng `storage.adoptPending` do phiên X thêm ở `a667d76` (chuyển key và nhận luôn loại, cỡ, kích thước; kiểm loại và cỡ sau khi nhận, sai thì đưa key chính thức vào thùng rác). 30 trang là 30 lời gọi, dưới trần 50. Postman 07 qua với Cloudinary thật.
7. **`purgeDeliveredVersions`**: mỗi sản phẩm một lô có guard, có tăng `version` của sản phẩm khi sửa `files` (điểm 4 của bản soát; bản cũ không tăng). Không gọi kho, 5 đơn mỗi lượt (đúng mục 7).
8. **`refreshCurrentRound`** tính "file còn được giữ" bằng JavaScript từ một lượt đọc (file của các vòng khác, file có góp ý ghim), không gọi `isRetained` từng file. Guard đầu lô đúng như dòng #25.
9. **`setCurrentPages`** dùng `transact` với `retries: 0`: guard `status` và `pages_rev` sai thì trả 409 ngay và đưa ảnh vừa nhận vào thùng rác, không chạy lại (ảnh đã nhận gắn với lần đọc đó). Đúng ý bảng "ghi có điều kiện".
10. **Chi tiết đơn (`GET /orders/:id`) trả `client` gồm `id, name, contacts, source, tags, notes: null`**, không có `version`, `createdAt`, `updatedAt`. Đây là đúng thứ bản cũ trả (populate chỉ bốn trường rồi qua `toPublicClient`), giữ nguyên.
11. `roundValidator.js` import `ratio`, `size`, `pendingKeySchema` từ `feedbackValidator.js` của phiên X (đã `export`). `shareLinkValidator.js` và `roundValidator.js` tự khai `deliverableIdParams` để không phụ thuộc `deliverableValidator.js`.

Không có chỗ nào đổi đường dẫn, mã trạng thái hay lời báo so với bản cũ.

## Xử lý kết quả soát thiết kế (`docs/soat-thiet-ke.md`)

Sau khi sửa: cả bộ Postman chạy lại trên dữ liệu trống, 406 request, 1377 phép kiểm, 0 lỗi (`qa-scripts/cf/ket-qua/2026-11-18_231315_y-sau-soat.md`); `thu-y34.js` 47 phép đạt; `thu-diem1.js` 27 phép đạt; lint sạch.

| Điểm    | Đã làm gì                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (cao) | `orderService.js`. Ba guard không nhãn trong lô của `setOrderMembers`, đặt sau `stale`: (a) `teamUnchangedGuard`: team trong `order_members` vẫn đúng là team `plan` đã đọc (cùng người, cùng `leader_position`); (b) `assignableGuard`: mọi người trong danh sách mới cùng tổ chức, `role <> 'admin'`, vai trò đúng như đã đọc, và không bị khóa trừ khi **lúc chạy lô** đang có dòng trong team của chính đơn đó (việc miễn tính bằng SQL, không theo danh sách đã đọc, và không áp cho admin); (c) `rolesUnchangedGuard`: vai trò của người bị gỡ vẫn như đã đọc, cho luật "chỉ quản trị viên gỡ được quản lý". Vì vai trò phải đúng như đã đọc và `plan` đã từ chối leader là viewer, không leader nào có thể là viewer lúc ghi. Câu xóa viết `member_id NOT IN (danh sách mới)`. `createOrder` dùng cùng `assignableGuard`, không miễn ai. Guard sai thì `transact` chạy lại `plan` và ra đúng lời cũ (ví dụ 400 "Quản trị viên thấy mọi đơn hàng nên không cần gán."). Không cần `updateMember` tăng `version` của đơn. |
| 1, thử  | `qa-scripts/cf/thu-diem1.js`: 12 lượt mỗi tình huống, bắn hai request cùng lúc lệch nhau 0 đến 5 ms theo cả hai chiều, rồi đọc thẳng D1. Tình huống A (hạ xuống viewer cùng lúc lưu team): sau cả 12 lượt không có viewer nào mang `leader_position`. Tình huống B (lên admin cùng lúc lưu team): sau cả 12 lượt không có admin nào trong `order_members`; 6 lượt lưu team nhận 400 đúng lời cũ, 6 lượt lưu team chạy trước. Phụ (leader gỡ người vừa lên quản lý): 6 lượt 403, 6 lượt gỡ trước khi đổi vai trò. Không chứng minh được có lượt nào rơi đúng vào khe giữa lúc đọc và lúc ghi của một lô; chỉ biết bất biến giữ ở mọi lượt.                                                                                                                                                                                                                                                                                                                                                                                     |
| 4       | `maintenanceService.js` viết lại: mỗi sản phẩm một lô, đầu lô guard đơn còn `delivered` và `versions_purged_at IS NULL`, guard `version` của sản phẩm như đã đọc, guard vòng mới nhất như đã đọc; rồi UPDATE `rounds.pages` của các vòng cũ, UPDATE `files` kèm `version + 1`, INSERT `storage_trash`. Mốc `versions_purged_at` đặt bằng `UPDATE ... WHERE status = 'delivered' AND versions_purged_at IS NULL`, và chỉ khi mọi sản phẩm của đơn đã qua; một guard sai thì cả đơn để lượt sau. **Vẫn chưa chạy thử** (lý do ở mục "Chưa thử"). Phiên X giữ `kien-truc.md`: cần thêm một dòng cho việc này vào bảng mục 4.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7       | `shareLinkService.js`: guard `status = 'active'` của sản phẩm luôn bật; khi link mở vòng 1 thêm guard `version` và `guardNot` "đã có vòng" không nhãn, `transact` tự chạy lại. Bỏ vòng lặp bắt lỗi trùng `(deliverable, number)`. Đã thử: hai link đầu tạo cùng lúc vẫn cả hai 201 và chỉ một vòng 1 (`thu-y34.js`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8       | `roundService.js`: bỏ nhánh bắt `uniqueViolationOf` ở `openNextRound` (code chết), còn một lời gọi `transact`. Không còn chỗ nào "bắt rồi chạy lại hàm" trong file của phiên Y. Đã thử: hai lần mở vòng cùng lúc vẫn một 201, một 409 "Vòng hiện tại còn mở...".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10      | Soát lại guard của phiên Y theo hai luật mới ở mục 3.2. Guard trên ngữ cảnh khách (`submitByGuest`, `approveByGuest`: vòng còn mở, có gì để gửi) đều có nhãn. Guard không nhãn nào cũng trùng với câu kiểm trong `plan`. `setCurrentPages` dùng `retries: 0` vì dữ liệu đọc nằm ngoài `plan`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11      | `listAssignableMembers`: câu SQL có `ORDER BY id`, và phép sắp theo tên trong JavaScript phá hòa bằng id. Các danh sách khác của phiên Y đã sắp theo cột duy nhất (`id`, `number`) hoặc đã có cột phá hòa (`position, member_id`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 14      | Không phải sửa: `contactId`, `memberIds`, `leaderIds`, `clientId`, `pages[].id`, `pins[].feedbackId`, và id trong query của hoạt động đều qua `objectIdSchema`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15      | Không phải sửa: lọc `clients.tags` bằng `json_each`; việc dọn bản cũ lọc "vòng có trang" bằng JavaScript sau khi đọc các vòng của đơn (cần mọi vòng để biết bộ file của vòng cuối), không có câu WHERE trên cột JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 19      | `setCurrentPages`: guard thêm điều kiện "vẫn là vòng mới nhất của sản phẩm".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 20      | Không phải sửa: người liên hệ mới được sinh `_id` trong `createOrder`; không có API sửa người liên hệ nên `_id` cũ không bị đụng (`updateClient` chỉ đổi `name`, `source`, `tags`, `notes`); trang của vòng được sinh `id` và `capturedAt` trong `setCurrentPages`; người liên hệ tạo cùng đơn luôn là `isPrimary: true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Về CPU (tin từ lần deploy thử): `listAssignableMembers` bỏ một truy vấn (dùng luôn team đã đọc cùng đơn); khách mở link bỏ một truy vấn (tên khách lấy chung). Còn một chỗ đọc lại có chủ ý: mọi thao tác ghi đơn (`createOrder`, `updateOrder`, `setOrderMembers`, `deliverOrder`, `reopenOrder`) đọc lại đơn kèm khách và team sau lô để trả đúng bản vừa lưu, tức 3 lượt tới D1 mỗi request (đọc, lô, đọc lại). Bỏ được lượt cuối bằng cách dựng kết quả từ `RETURNING` và dữ liệu đã đọc, nhưng chưa làm vì chưa có số đo cho thấy cần; chờ luật giữ CPU thấp ở `kien-truc.md` mục 11.

## Điều cần phiên X hoặc phiên điều phối

- (Đã xong) Điểm lệch 6: phiên X đã thêm `storage.adoptPending`, phiên Y đã dùng.
- Cách thử việc dọn bản cũ mà không kích việc dọn file tạm trên Cloudinary thật.
- Thêm một dòng cho `purgeDeliveredVersions` vào bảng mục 4 của `kien-truc.md` (điểm 4 của bản soát).
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
