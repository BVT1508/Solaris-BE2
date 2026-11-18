# Tiến độ và bàn giao

Cập nhật: 18/11/2026 (đêm), sau phiên kiến trúc. File này là điểm vào cho phiên mới: đọc nó, rồi `docs/kien-truc.md` (mục 1, 11, 3, 12), rồi tài liệu của backend cũ ghi trong `CLAUDE.md`.

## Đã xong

| Phần                        | Nội dung                                                                                                                                                                                                                                                                    | Đã thử                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Cấu hình                    | `package.json` (chỉ `hono`, `zod`), `wrangler.jsonc` (D1, Durable Object, assets, 2 cron, 5 bộ giới hạn tần suất), ESLint, Prettier, `.dev.vars.example`, `scripts/`                                                                                                        | `npm run lint` sạch; `wrangler dev` lên ở `127.0.0.1:4000`                                                             |
| Lược đồ                     | `migrations/0001_init.sql`: 12 bảng nghiệp vụ, 3 bảng hạ tầng (`rate_counters`, `storage_trash`, `tx_guard` kèm trigger)                                                                                                                                                    | Áp vào D1 cục bộ được                                                                                                  |
| Nền dùng chung              | Hono app, đọc body, header bảo mật, CORS, kiểm Origin, giới hạn tần suất, `validate`, `AppError`, xử lý lỗi, log, `policy.js`, `auditStatement`, lớp truy vấn D1 (`sql`, `transact`, `guard`), `defineModel` và khai báo mọi bảng, id, thời gian, tìm không dấu, phân trang | Postman nhóm 08, 09; kịch bản tạm 22 phép kiểm cho `transact`, guard, bộ đếm, trạng thái đơn, tìm kiếm (đạt, xem dưới) |
| Câu lệnh dùng chung         | `syncOrderStatusStatement`, `orderNotDeliveredGuard` (`orderStatusService.js`), `unassignOpenWorkStatement` (`unassignService.js`), luật thuần của góp ý (`feedbackRules.js`)                                                                                               | Trạng thái đơn: 10 tình huống; bỏ giao việc: 2                                                                         |
| Lát mẫu: đăng nhập và phiên | `/api/v1/auth/*`: danh sách và đăng nhập dev, `me`, `logout`, bắt đầu và callback Google; tự tạo tổ chức và chủ hệ thống (`ensureOwner`)                                                                                                                                    | Postman nhóm 01                                                                                                        |
| Kết nối trực tiếp           | Durable Object `RealtimeHub`, bắt tay ở `GET /api/v1/realtime`, `notifyFeedback`, `disconnectMember`, `disconnectLink`, `disconnectGuestsOf`                                                                                                                                | Kịch bản tạm 6 tình huống với WebSocket thật (xem `docs/hop-dong-realtime.md` mục 8)                                   |
| Việc định kỳ                | Khung cron; việc dọn phiên, state, bộ đếm hết hạn                                                                                                                                                                                                                           | Gọi tay trên máy dev, chạy đúng                                                                                        |
| Chỗ cho các gói việc        | Mọi file route và file job của các gói đã tạo sẵn (rỗng) và đã gắn trong `routes/index.js`, `jobs/index.js`                                                                                                                                                                 | Đường chưa làm trả 401 (chưa đăng nhập) hoặc 404                                                                       |
| Tài liệu                    | `docs/kien-truc.md`, `docs/hop-dong-realtime.md`                                                                                                                                                                                                                            |                                                                                                                        |

### Số liệu Postman (18/11/2026, D1 cục bộ, environment `Solaris local` của backend cũ, không sửa gì trong bộ Postman)

`postman collection run "postman/collections/Solaris BE" -e "postman/environments/Solaris local.environment.yaml" -i "01 Auth" -i "08 Lỗi chung" -i "09 Bảo mật"` (chạy trong thư mục `Solaris BE`):

| Nhóm         | Request | Kiểm tra | Không đạt |
| ------------ | ------- | -------- | --------- |
| 01 Auth      | 7       | 29       | 0         |
| 08 Lỗi chung | 3       | 12       | 0         |
| 09 Bảo mật   | 4       | 17       | 0         |
| Cộng         | 14      | 58       | 0         |

Các nhóm 02 tới 07 và 10 tới 13 (392 request) chưa có API nên chưa chạy.

## Chưa thử

- Bất cứ thứ gì trên Cloudflare thật (chưa deploy, chưa đăng nhập `wrangler`): 10 ms CPU, D1 thật, trigger guard trên D1 thật, Rate Limiting binding trên gói miễn phí, Durable Object ngủ đông.
- Đăng nhập Google tới cùng (mới thử: chuyển sang Google đúng tham số, callback với state lạ và với `error`).
- Kết nối trực tiếp của khách, phát `feedback:event`, loại trừ theo `X-Socket-Id`, alarm kiểm lại phiên (cần link và góp ý).
- Cloudinary qua HTTP: mới có thiết kế ở `docs/kien-truc.md` mục 8, chưa có dòng code nào.
- Phục vụ bản build thật của frontend qua Worker (mới có trang giữ chỗ trong `frontend-dist/`).
- Vượt trần giới hạn tần suất (chưa bắn đủ số request để nhận 429).

## Bước kế tiếp

Theo `docs/kien-truc.md` mục 12. Ngày 1: phiên X làm gói X1 (thành viên), phiên Y làm gói Y1 (khách hàng, đơn hàng), song song. Phiên điều phối duyệt tài liệu kiến trúc trước khi mở hai phiên đó. Phiên frontend có thể bắt đầu đổi `realtime.js` theo `docs/hop-dong-realtime.md` ngay.

Bốn câu cần chủ dự án quyết: `docs/kien-truc.md` mục 13 (không chặn ngày 1 và 2).

## Cách chạy và thử

```
npm install
copy .dev.vars.example .dev.vars      rồi điền OWNER_EMAIL (máy này đã có .dev.vars, chép từ .env của backend cũ)
npm run dev                           tự áp migration vào D1 cục bộ rồi chạy wrangler dev ở http://127.0.0.1:4000
npm run lint
npm run format
```

- D1 cục bộ nằm ở `.wrangler/state/v3/d1` (không commit). Xem dữ liệu: `npx wrangler d1 execute DB --local --command "SELECT id, email, role, status FROM members"`.
- Muốn database trống lại: tắt server rồi xóa thư mục `.wrangler/state` (chỉ là dữ liệu thử trên máy; hỏi chủ dự án trước nếu trong đó có thứ cần giữ).
- Postman: chạy trong thư mục `Solaris BE`, lệnh như ở trên; thêm `-i "<tên nhóm>"` cho từng nhóm. Server phải ở đúng cổng 4000.
- Cron trên máy dev: `curl "http://127.0.0.1:4000/cdn-cgi/local/scheduled?cron=23+*+*+*+*"`, kết quả trong log của `wrangler dev`.
- Kết nối trực tiếp: Node 22 có sẵn `WebSocket`; truyền cookie bằng `new WebSocket(url, { headers: { Cookie } })`.
- Frontend khi dev: `npm run dev` ở `Solaris FE` (cổng 5173, proxy `/api` sang 4000) như cũ.
- Kịch bản thử để ở `D:\Work\New folder\qa-scripts\`, không để trong repo. Hai kịch bản tạm của phiên kiến trúc (thử `transact` và WebSocket) nằm ở thư mục tạm của phiên, không giữ lại.

## Bẫy đã gặp

- **Mẫu `LIKE` của D1 tối đa 50 byte.** Tìm kiếm dùng `instr` (`matches()` trong `src/utils/searchText.js`), không dùng `LIKE`.
- **`sqlite_version()` và vài hàm khác bị D1 chặn** ("not authorized"). Đừng dựa vào hàm hệ thống của SQLite khi chưa thử.
- **Prettier thêm dấu phẩy cuối vào `wrangler.jsonc`**: wrangler vẫn đọc được, không phải lỗi.
- **`Date.now()` đứng yên giữa hai lần chờ I/O trong Worker.** Hai id sinh liền nhau vẫn tăng dần nhờ `newId()` tự đẩy mốc; nhưng đừng đo thời gian bằng `Date.now()` quanh đoạn code không có I/O.
- **Không dùng chung promise giữa các request** (ví dụ nhớ một promise đang chạy ở biến cấp module): Worker báo lỗi I/O khác request. Bộ đệm cấp module chỉ giữ giá trị đã xong (`ensureOwnerOnce` dùng cờ boolean).
- **Response nâng cấp WebSocket không cho sửa header**: đường `/api/v1/realtime` đi riêng ở `src/index.js`, không qua middleware của `src/app.js`.
- **Hono: `route.use("/orders/*", ...)` khớp cả `/orders`.** `protect` gắn một lần theo tiền tố ở `routes/index.js`; gắn lại trong file route là đọc phiên hai lần.
- **Query của Hono (`c.req.query()`) chỉ lấy giá trị đầu khi khóa lặp lại** và không dựng object lồng như Express. Schema `.strict()` vẫn từ chối khóa lạ.
- **Lệnh shell dài có heredoc chứa `'$[#]'` hoặc dấu nháy lồng** hay vỡ cú pháp trong Git Bash: ghi file bằng công cụ ghi file rồi mới chạy.
- **`wrangler dev` tự nạp lại code khi file đổi**, nhưng nếu lúc đó thiếu file được import thì log báo lỗi build và bản cũ tiếp tục chạy: xem `.wrangler/dev.log` hoặc màn hình `wrangler dev` khi thấy thay đổi không có hiệu lực.
- **Cổng 4000**: backend cũ cũng dùng cổng này. Trước khi chạy `npm run dev` kiểm xem có server nào đang giữ cổng; đừng tắt server của chủ dự án (xem mục "Bẫy đã biết" trong `docs/tien-do.md` của backend cũ về cách nhận ra tiến trình).
- **Số chỗ `withTransaction`**: đếm thật là 28 (lời giao việc ghi 38). Bảng đầy đủ ở `docs/kien-truc.md` mục 4.
- **Lời commit**: commit đầu của repo có dòng `Co-Authored-By`, các commit của phiên kiến trúc giữ theo; dòng tiêu đề vẫn là một dòng tiếng Anh chữ thường.
