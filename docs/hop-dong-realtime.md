# Hợp đồng kết nối trực tiếp (WebSocket)

Cho phiên frontend: đủ để thay `socket.io-client` trong `Solaris FE/src/services/realtime.js` mà không đọc code server. Thay cho mục 8 "Chat trực tiếp (Socket.IO)" của `docs/api-gop-y.md` bên backend cũ. Ý nghĩa của sự kiện, luật tiếng báo, header `X-Socket-Id` không đổi; chỉ đổi cách nối và khung tin.

Server chỉ báo "có thay đổi", không gửi nội dung. Nhận tin thì gọi lại API đang có, như trước.

## 1. Địa chỉ và xác thực

WebSocket thường của trình duyệt (`new WebSocket(url)`), không cần thư viện. Cùng địa chỉ với API:

| Ai         | URL                                                     | Xác thực                                                            |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Thành viên | `wss://<origin>/api/v1/realtime`                        | Cookie phiên `solaris_sid`, trình duyệt tự gửi vì cùng origin       |
| Khách      | `wss://<origin>/api/v1/realtime?token=<token của link>` | Token của link chia sẻ (32 ký tự, chính là token trong `/r/:token`) |

- `<origin>` là origin của trang. Dựng URL: `new URL("/api/v1/realtime", window.location.origin)` rồi đổi `http` thành `ws` (`https` thành `wss`).
- Khi dev qua Vite: thêm `ws: true` vào mục proxy `/api` trong `vite.config.js` và bỏ mục `/socket.io`. Giữ `changeOrigin: false`.
- Server chỉ nhận kết nối từ origin được phép (danh sách `CLIENT_ORIGINS`, hoặc cùng origin với API). Origin lạ: bắt tay hỏng (sự kiện `error` rồi `close` mã 1006).
- Gỡ `socket.io-client` khỏi `package.json`.
- **Có `?token=` thì kết nối luôn là khách**, kể cả khi trình duyệt gửi kèm cookie của một thành viên đang đăng nhập (trang `/r/:token` cùng origin nên cookie tự đi theo). `connectGuest(token)` với token sai dạng nhận mã đóng 4404.
- **Vì sao token nằm trên địa chỉ** (không nằm trong tin đầu tiên): token này vốn đã nằm trong đường dẫn của trang (`/r/<token>`) và của mọi lời gọi API của khách (`/api/v1/r/<token>/...`) tới cùng máy chủ, nên đặt ở query của kết nối không lộ thêm cho ai. Đổi lại, server xác thực xong trước khi nhận kết nối, không phải giữ kết nối chưa xác thực và không cần hạn chờ cho tin đầu. Log của ứng dụng che token ở cả đường dẫn lẫn query.

## 2. Vòng đời một kết nối

```
trình duyệt                         server
    │ ── mở WebSocket ───────────────► │
    │ ◄── {"type":"ready","socketId":"..."} ─── │   xác thực đạt
    │                                           │
    │ ── {"type":"deliverable:watch","id":1,"deliverableId":"..."} ─► │   chỉ thành viên
    │ ◄── {"type":"ack","id":1,"ok":true} ───── │
    │                                           │
    │ ◄── {"type":"feedback:event","data":{...}} │   mỗi khi có thay đổi
    │                                           │
    │ ── "ping" ─────────────────────────────► │   mỗi 30 giây, để giữ kết nối
    │ ◄── "pong" ───────────────────────────── │
```

Xác thực **không đạt** thì kết nối vẫn mở được trong chốc lát (trình duyệt không đọc được mã HTTP của lần bắt tay hỏng): server gửi một tin lỗi rồi đóng ngay bằng mã đóng riêng.

```
    │ ◄── {"type":"error","status":401,"message":"Bạn chưa đăng nhập hoặc phiên đã hết hạn."} │
    │ ◄── close, code 4401                      │
```

## 3. Tin server gửi

Mọi tin là chuỗi JSON có trường `type`, trừ chuỗi trần `pong`.

| `type`                               | Nội dung                                                                                         | Khi nào                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                              | `{ "type": "ready", "socketId": "<20 ký tự>" }`                                                  | Ngay sau khi nối và xác thực đạt. `socketId` thay cho `socket.id` cũ.                                                                                                           |
| `ack`                                | `{ "type": "ack", "id": <id đã gửi>, "ok": true }` hoặc `{ ..., "ok": false, "message": "..." }` | Trả lời một lệnh `deliverable:watch` hoặc `deliverable:unwatch`. `id` là số trình duyệt gửi kèm lệnh. Server xử lý lệnh của một kết nối lần lượt, nên `ack` về đúng thứ tự gửi. |
| `feedback:event`                     | `{ "type": "feedback:event", "data": { ... } }`                                                  | Góp ý của một sản phẩm đang theo dõi vừa đổi. `data` đúng như sự kiện `feedback:event` cũ.                                                                                      |
| `error`                              | `{ "type": "error", "status": 401, "message": "..." }`                                           | Chỉ khi xác thực lúc nối không đạt; ngay sau đó kết nối đóng.                                                                                                                   |
| `pong` (chuỗi trần, không phải JSON) | `pong`                                                                                           | Trả lời `ping`. Kiểm `event.data === "pong"` trước khi `JSON.parse`.                                                                                                            |

`data` của `feedback:event` (không đổi so với trước):

```json
{
  "deliverableId": "…",
  "feedbackId": "…",
  "kind": "reply",
  "visibility": "customer",
  "at": "2026-11-12T09:54:21.679Z",
  "actor": { "kind": "member", "memberId": "…", "name": "Nhân viên An" }
}
```

- `kind`: `reply`, `status`, `verdict`, `created`, `deleted`, `submitted`, `approved`, `round`. Nghĩa và việc phải tải lại như bảng ở mục 8 của `docs/api-gop-y.md` cũ: `reply`, `status`, `verdict` thì tải lại đúng bài `feedbackId`; `created`, `deleted`, `submitted`, `approved`, `round` thì tải lại danh sách và thông tin vòng (`feedbackId` là `null` với `submitted`, `approved`, `round`).
- `visibility` là `team` thì chỉ phía team nhận.
- Phía khách, `actor` chỉ có `kind` (`member` hoặc `guest`), không có tên hay id.

## 4. Lệnh trình duyệt gửi

| Lệnh              | Tin gửi                                                                   | Ai         | Ghi chú                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theo dõi sản phẩm | `{ "type": "deliverable:watch", "id": 1, "deliverableId": "<24 hex>" }`   | thành viên | Server kiểm quyền đọc góp ý của đơn rồi trả `ack`. Tối đa 30 sản phẩm mỗi kết nối. Quá 40 lệnh trong 10 giây thì `ack` với `ok: false`.                                          |
| Thôi theo dõi     | `{ "type": "deliverable:unwatch", "id": 2, "deliverableId": "<24 hex>" }` | thành viên | Luôn `ok: true`.                                                                                                                                                                 |
| Giữ kết nối       | chuỗi trần `ping`                                                         | cả hai     | **Trình duyệt gửi**, mỗi 30 giây khi kết nối đang mở. Server trả `pong` ngay. Quá 10 giây sau một `ping` không thấy `pong` thì coi như kết nối chết: đóng và nối lại theo mục 5. |

- `id` là số (hoặc chuỗi ngắn) do trình duyệt tự tăng, để ghép `ack` với lệnh; bỏ `id` cũng được (`ack` mang `id: null`). Frontend hiện không đọc nội dung `ack`: không cần chờ `ack`, không cần hạn chờ; bị từ chối thì màn vẫn dùng được, chỉ không tự cập nhật (như trước).
- Lệnh của một kết nối được xử lý **theo đúng thứ tự gửi**. Chuỗi `watch`, `unwatch`, `watch` gửi liền nhau (StrictMode chạy effect hai lần) kết thúc ở trạng thái đang theo dõi; `watch` rồi `unwatch` ngay kết thúc ở trạng thái không theo dõi.
- Kết nối đóng thì server tự quên mọi thứ nó theo dõi: rớt mạng không cần gửi `unwatch`.
- Khách không cần gửi gì: nối bằng token là nghe sẵn đúng sản phẩm của link. Khách gửi `deliverable:watch` cho đúng sản phẩm đó thì nhận `ok: true`, sản phẩm khác thì `ok: false`.
- Tin dài quá 1.024 ký tự hoặc không phải JSON bị bỏ qua, không có trả lời.
- **Server không nhớ danh sách theo dõi qua các lần nối**: sau mỗi lần nhận `ready` (lần đầu và mỗi lần nối lại), gửi lại `deliverable:watch` cho mọi sản phẩm đang theo dõi.

## 5. Mã đóng và nối lại

Đọc `event.code` ở sự kiện `close`.

| Mã                                           | Nghĩa                                                                                                                                             | Nên làm                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4401                                         | Chưa đăng nhập, phiên hết hạn, tài khoản bị khóa (lúc nối, lúc xin theo dõi, hoặc lần kiểm lại 10 phút một lần)                                   | **Không nối lại.** Như `connect_error` 401 cũ.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4404                                         | Link không hợp lệ, không tồn tại hoặc đã thu hồi                                                                                                  | **Không nối lại.**                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4410                                         | Sản phẩm của link đã lưu trữ                                                                                                                      | **Không nối lại.**                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4000                                         | Server chủ động ngắt vì quyền vừa đổi: đăng xuất, bị khóa, đổi vai trò, bị gỡ khỏi đơn (thành viên); link bị thu hồi, sản phẩm bị lưu trữ (khách) | Nối lại **ngay, một lần**, như `io server disconnect` cũ; nếu vừa nối lại kiểu này trong 5 giây trước đó thì thôi (giữ luật `REJOIN_GAP_MS`). Server ngắt sau khi thay đổi quyền đã lưu xong, nên lần nối lại luôn được kiểm theo quyền mới: mất quyền hẳn (đăng xuất, bị khóa, link thu hồi, sản phẩm lưu trữ) thì nhận 4401, 4404 hoặc 4410 và dừng; chỉ đổi vai trò hay bị gỡ khỏi một đơn thì nối lại được và `deliverable:watch` của đơn đó nhận `ok: false`. |
| 4500                                         | Server lỗi lúc xác thực                                                                                                                           | Nối lại theo nhịp giãn dần.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| còn lại (1006 mất mạng, 1001, 1012, 1013...) | Rớt mạng, server cập nhật phiên bản, bị chặn vì mở quá nhiều kết nối (120 lần mỗi phút mỗi IP)                                                    | Nối lại theo nhịp giãn dần: 1 giây, 2, 4, 8, tối đa 30 giây, có cộng trừ ngẫu nhiên. Về lại 1 giây khi nhận `ready`.                                                                                                                                                                                                                                                                                                                                               |

- Khi Worker được deploy bản mới, mọi kết nối có thể bị đóng: phải tự nối lại được.
- Đăng xuất, hết phiên, rời màn review của khách: trình duyệt tự đóng (`ws.close(1000)`) và không nối lại.
- WebSocket của trình duyệt không tự nối lại như Socket.IO: toàn bộ việc nối lại do `realtime.js` tự lo, và phải hủy hẹn giờ nối lại khi `closeRealtime()`.
- Mã 4403 để dành (chưa dùng); gặp thì coi như 4401: không nối lại.
- **Mã 4503: hệ thống đang tạm ngừng vì hết hạn mức gói miễn phí của hôm nay** (thêm 21/11/2026). Tin `error` ngay trước đó là `{ type: "error", status: 503, code: "quota_paused", message }`. Không nối lại; hiện màn báo hết lưu lượng như khi API trả 503 `quota_paused` (`docs/api-bo-sung.md`). Server từ chối trước khi đọc phiên hay link nên không tốn database.
- **Vì sao trình duyệt gửi `ping` chứ không phải server** (Socket.IO thì server gửi): server giữ kết nối ở trạng thái ngủ để không tốn hạn mức; `ping` của trình duyệt được hạ tầng trả `pong` mà không đánh thức server. Server tự gửi ping thì phải thức định kỳ cho mọi kết nối.
- Như hiện nay: frontend không tải lại dữ liệu sau khi nối lại (tin phát lúc rớt mạng bị mất), và request ghi gửi trong lúc đang nối lại không mang `X-Socket-Id`. Hai điều này do frontend quyết; server không phát lại tin cũ.

## 6. `X-Socket-Id` (không đổi)

Mọi request ghi dữ liệu gửi kèm header `X-Socket-Id: <socketId>` với `socketId` lấy từ tin `ready` của chính tab đó (20 ký tự chữ, số, `_`, `-`; server chỉ nhận mã 10 đến 40 ký tự thuộc bộ đó). Các tab khác của cùng người vẫn nhận tin. Server không báo sự kiện do request ấy gây ra về lại kết nối đó. Header tùy chọn; thiếu thì tab gửi cũng nhận tin của chính mình. Mất kết nối thì đặt `socketId` về `null` (không gửi header) cho tới khi nhận `ready` mới: mỗi lần nối lại `socketId` đổi.

## 7. Ghép vào `realtime.js` hiện có

Các hàm xuất giữ nguyên chữ ký: `connectMember()`, `connectGuest(token)`, `closeRealtime()`, `watchDeliverable(id)`, `onFeedbackEvent(handler)`. Bên trong đổi như sau:

| Socket.IO cũ                                                | WebSocket thường                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `io(ORIGIN, { path: "/socket.io", withCredentials: true })` | `new WebSocket(wsUrl("/api/v1/realtime"))`                                                       |
| `io(ORIGIN, { auth: { token } })`                           | `new WebSocket(wsUrl("/api/v1/realtime?token=" + encodeURIComponent(token)))`                    |
| `socket.on("connect")`, `setSocketId(socket.id)`            | tin `ready`: `setSocketId(msg.socketId)`, gửi lại `deliverable:watch` cho mọi id trong `watched` |
| `socket.emit("deliverable:watch", { deliverableId }, ack)`  | `ws.send(JSON.stringify({ type: "deliverable:watch", id: ++seq, deliverableId }))`               |
| `socket.on("feedback:event", handler)`                      | tin có `type === "feedback:event"`: gọi `handler(msg.data)`                                      |
| `disconnect` với lý do `io server disconnect`               | `close` mã 4000                                                                                  |
| `connect_error` với `err.data.status` 401, 403, 404, 410    | `close` mã 4401, 4404, 4410 (tin `error` ngay trước đó mang `message` để hiện nếu cần)           |
| thư viện tự nối lại                                         | tự viết theo bảng ở mục 5                                                                        |
| thư viện tự ping                                            | gửi `ping` mỗi 30 giây khi `ws.readyState === WebSocket.OPEN`                                    |

Chỉ gửi lệnh khi đã nhận `ready` (trước đó `watchDeliverable` chỉ ghi vào `watched`, như hiện nay với `socket?.connected`).

## 8. Trạng thái phía server

Đã đối chiếu với `Solaris FE/docs/fe-dung-api.md` mục 3.11 và 3.12: chín điều phải giữ và mười việc Socket.IO làm hộ đều có câu trả lời ở các mục trên (mã kết nối ở tin `ready`; lý do từ chối bằng mã đóng 44xx; server ngắt bằng mã 4000; tự nối lại và `ping` do `realtime.js` lo; `ack` giữ nhưng không bắt buộc đọc; loại tin ở trường `type`; token của khách ở query).

Đã viết và đã thử trên máy dev bằng kết nối WebSocket thật: năm lệnh gửi liền nhau nhận `ack` đúng thứ tự; vừa có cookie thành viên vừa có token lạ thì bị coi là khách (4404); token sai dạng (4404); nối không cookie (4401), Origin lạ (bắt tay hỏng), token link không tồn tại (4404), thành viên nối và nhận `ready`, `ping` và `pong`, `deliverable:watch` bị từ chối đúng lời khi không có quyền hoặc id sai, `deliverable:unwatch`, đăng xuất thì nhận mã 4000, nối lại bằng phiên đã hủy (4401).

**Server ngắt kết nối chưa gửi khung nào, trên `wrangler dev`** (đã xem 19/11/2026, không sửa code). Khi server ngắt bằng mã 4000, khung đóng kèm mã luôn tới client, client trả lời, và phía server `webSocketClose` chạy với `wasClean` đúng: phần của hub đủ. Nhưng nếu client chưa từng gửi khung nào (kể cả `ping`) thì tầng `wrangler dev` không ngắt TCP sau khi bắt tay đóng xong; đã gửi ít nhất một khung (một `ping` là đủ, dù `ping` không vào tới code của hub) thì TCP được ngắt sau khoảng 20 ms. Trình duyệt tự ngắt sau bắt tay đóng nên nhận `close` mã 4000 bình thường (phiên frontend đã thấy khách nhận 4000 rồi 4404). WebSocket có sẵn của Node 22 thì chờ server ngắt TCP nên kẹt ở `readyState` 2 và không phát `close`: kịch bản thử viết bằng Node nên gửi một `ping` ngay sau tin `ready`. Dò ở mức TCP: `qa-scripts/cf/x_do_dong_ws.mjs`. Chưa thử trên Cloudflare thật.

Chưa thử: khách nối bằng token thật, nhận `feedback:event` ở cả hai phía, loại trừ theo `X-Socket-Id`. Các phần này thử được khi API link chia sẻ và góp ý xong (ngày 2). Phiên frontend có thể viết `realtime.js` ngay từ bây giờ với phần đã chạy.
