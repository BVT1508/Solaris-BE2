# Kiến trúc Solaris CF

Viết ngày 18/11/2026 bởi phiên kiến trúc, cho các phiên code đọc và làm theo. Mọi thứ ghi "đã thử" là đã chạy trên `wrangler dev` cục bộ (wrangler 4.164.0, Node 22.13); chưa có gì chạy trên Cloudflare thật.

Đọc theo thứ tự: mục 1 (bức tranh), mục 11 (quy ước và mẫu code), mục 3 (cách thay giao dịch), rồi mục 12 (gói việc của mình). Các mục còn lại tra khi cần.

## 1. Tổng quan

```
Trình duyệt ──► Cloudflare (một Worker tên "solaris", địa chỉ *.workers.dev)
                 │
                 ├─ đường dẫn KHÔNG bắt đầu bằng /api/  → static assets (bản build của Solaris FE, thư mục frontend-dist)
                 │                                         không khớp file nào thì trả index.html (React Router)
                 │
                 └─ /api/*  → Worker (src/index.js)
                      ├─ GET /api/v1/realtime      → nâng cấp WebSocket → Durable Object RealtimeHub (một object, tên "hub")
                      └─ còn lại                   → app Hono (src/app.js) → routes → controllers → services → D1
                                                      services gọi ra ngoài bằng fetch: Cloudinary, Google
Cron Triggers ──► scheduled() trong src/index.js → src/jobs
```

- **Một Worker.** File tĩnh do Cloudflare phục vụ trước khi tới Worker (không tốn lượt request của gói miễn phí). Chỉ `/api/*` vào Worker (`run_worker_first` trong `wrangler.jsonc`). Lưu ý: với chế độ SPA, mọi đường dẫn ngoài `/api/*` mà trình duyệt mở trực tiếp đều nhận `index.html`, không bao giờ tới Worker. Route server nào cần trình duyệt mở thẳng (callback của Google) phải nằm dưới `/api/`; hiện đã đúng.
- **Không còn `req`, `res`, `process.env` toàn cục.** Cấu hình và binding lấy qua `import env from "../config/env.js"` và `import { db } from "../db/d1.js"`, dùng được ở mọi file, không phải truyền `c.env` (đã thử: `import { env } from "cloudflare:workers"` có giá trị ngay lúc nạp module).
- **Worker không giữ bộ nhớ giữa các request.** Biến cấp module chỉ là bộ đệm của một isolate, có thể mất bất cứ lúc nào. Không lưu gì cần đúng vào đó.
- **Không dùng gói npm cần Node thật.** Phụ thuộc chạy chỉ có `hono` và `zod`. Không có mongoose, cloudinary SDK, google-auth-library, pino, socket.io, pdf-lib, image-size.

## 2. Lược đồ D1

File chuẩn: `migrations/0001_init.sql`. Khai báo ánh xạ cột trong code: `src/models/memberModel.js` và `src/models/index.js`. Thêm cột thì thêm migration mới `0002_*.sql` (không sửa 0001) và sửa model tương ứng; báo phiên điều phối vì file model là file dùng chung.

### 2.1 Quy ước

| Thứ          | Cách lưu                                                                                    | Ghi chú                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | TEXT 24 ký tự hex chữ thường, sinh bằng `newId()` (`src/utils/id.js`)                       | 8 ký tự đầu là giây như ObjectId, 4 ký tự kế là phần lẻ của giây, 12 ký tự ngẫu nhiên. Sắp theo id là sắp theo thời gian tạo; id sinh liền nhau trong một request luôn tăng dần.             |
| id nhận vào  | validator đổi sang chữ thường (`objectIdSchema` trong `src/validators/common.js`)           | Backend cũ nhận cả chữ hoa; D1 so chuỗi phân biệt hoa thường.                                                                                                                                |
| thời gian    | TEXT ISO-8601 UTC có mili giây, sinh bằng `now()` (`src/utils/time.js`)                     | Đúng dạng JSON cũ trả ra nên đọc là trả thẳng. So sánh chuỗi là so sánh thời gian. Ngày từ validator (Date) đổi bằng `toIso()`.                                                              |
| boolean      | INTEGER 0 hoặc 1, khai `bool("cột")` trong model                                            |                                                                                                                                                                                              |
| phần lồng    | TEXT chứa JSON, khai `json("cột")` trong model                                              | Chỉ cho phần luôn đọc và ghi cùng bản ghi cha. Mỗi dòng D1 tối đa 2 MB.                                                                                                                      |
| `version`    | INTEGER, bắt đầu 1, mọi câu UPDATE sửa dữ liệu người dùng thấy đều `version = version + 1`  | Như cũ.                                                                                                                                                                                      |
| `updated_at` | Mongoose tự đổi ở mọi lần ghi; ở đây **mỗi câu UPDATE phải tự đặt `updated_at = ${now()}`** | Quên là `updatedAt` trả ra bị cũ.                                                                                                                                                            |
| `created_at` | đặt lúc INSERT (cùng giá trị với `updated_at`)                                              |                                                                                                                                                                                              |
| trường ẩn    | model cũ đặt `select: false`; ở đây `fromRow` trả mọi cột                                   | `toPublic` phải liệt kê từng trường, không spread. Các trường ẩn: `Member.googleSub`, `Deliverable.sdkKey`, `ShareLink.token`, `Feedback.authorDeviceHash`, `deviceHash` trong từng trả lời. |
| khóa ngoại   | D1 bật kiểm khóa ngoại mặc định                                                             | Trong một lô, chèn bản ghi cha trước bản ghi con.                                                                                                                                            |

**Trả JSON giống hệt `toPublic` cũ.** Chép hàm `toPublic` của service cũ, đổi `x._id` thành `x.id`. Thời gian và id đã là chuỗi đúng dạng. Ba chỗ API cũ trả thẳng document nên khóa là `_id`, phải giữ: danh sách đăng nhập dev (`GET /auth/dev/members`, đã làm), `contacts` của khách hàng (lưu luôn khóa `_id` trong JSON), và mọi chỗ service cũ trả `.lean()` không qua `toPublic` (khi gặp thì đối chiếu response thật của backend cũ).

### 2.2 Đối chiếu từng model

| Model cũ     | Bảng                        | Thành cột                                                                                                                                                                                       | Thành JSON trong dòng                                                                                                               | Khác                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization | `organizations`             | `name`                                                                                                                                                                                          |                                                                                                                                     |                                                                                                                                                                                                                                                                       |
| Member       | `members`                   | `org`, `email` (duy nhất), `name`, `role`, `status`, `googleSub` (duy nhất khi có), `capacity`, `paused`, `slackUserId`, `version`                                                              | `skills` `[{ skill, level }]`                                                                                                       | **`orders` và `leadOrders` không còn là cột**: suy ra từ bảng `order_members` (cột phụ `TEAMS_COLUMN`, hàm `toMember` trong `memberModel.js`). Thêm cột `search_text`.                                                                                                |
| Session      | `sessions`                  | `tokenHash` (duy nhất), `member`, `expiresAt`, `userAgent`                                                                                                                                      |                                                                                                                                     | Không có TTL index: mọi câu đọc phải kèm `expires_at > now`; cron mỗi giờ xóa dòng hết hạn.                                                                                                                                                                           |
| OauthState   | `oauth_states`              | `state` (khóa chính), `codeVerifier`, `expiresAt`                                                                                                                                               |                                                                                                                                     | Như Session.                                                                                                                                                                                                                                                          |
| Client       | `clients`                   | `org`, `name`, `source`, `notes`, `version`                                                                                                                                                     | `contacts` `[{ _id, name, phone, email, isPrimary }]`, `tags` `[chuỗi]`                                                             | Thêm `name_search` (tên bỏ dấu, cho tìm đơn theo tên khách) và `search_text` (tên cùng mọi người liên hệ, cho ô tìm khách). Lọc theo tag: `EXISTS (SELECT 1 FROM json_each(clients.tags) WHERE value = ${tag})`.                                                      |
| Order        | `orders` và `order_members` | `org`, `client`, `type`, `title`, `description`, `deadline`, `status`, `notes`, `createdBy`, `deliveredAt`, `reopenedAt`, `versionsPurgedAt`, `version`                                         |                                                                                                                                     | **`members` và `leaders` tách sang `order_members`** (`order_id`, `member_id`, `position`, `leader_position`). `leader_position` NULL là không phải leader. Bỏ `statusSyncedAt` (xem mục 3.4). Thêm `title_search`.                                                   |
| Deliverable  | `deliverables`              | `org`, `order`, `type`, `name`, `url`, `sdkKey` (duy nhất khi có), `status`, `archivedAt`, `createdBy`, `bridgeSeenAt`, `feedbackSeq`, `version`                                                | `files` `[{ id, provider, key, contentType, bytes, width, height, pages, originalName, replaces, removedAt, createdAt }]`           | Bỏ `snapshotAt` (xem mục 3.4). Phần tử của `files` dùng khóa `id` (không phải `_id`).                                                                                                                                                                                 |
| ShareLink    | `share_links`               | mọi trường, `token` duy nhất                                                                                                                                                                    |                                                                                                                                     |                                                                                                                                                                                                                                                                       |
| Round        | `rounds`                    | `org`, `order`, `deliverable`, `number` (duy nhất theo sản phẩm), `status`, `openedBy`, `openedAt`, `url`, `note`, `submittedAt`, `submittedByLink`, `approvedAt`, `approvedByLink`, `pagesRev` | `files` `[id]`, `pages` `[{ id, pageUrl, shot: {...}, docSize, pins: [{ feedback, x, y }], capturedAt, late }]`                     | Bỏ `lastDraftAt`. `files` luôn là mảng (dữ liệu bắt đầu trống nên không còn "vòng cũ chưa có bản chụp"): **bỏ `freezeLegacyRound` và nhánh `legacy` trong `openByToken`**; `fileIds` trả ra luôn là mảng.                                                             |
| Feedback     | `feedback`                  | `author` trải thành `authorKind`, `authorName`, `authorMember`, `authorDeviceHash`; `target` trải thành `targetFileId`, `targetPage`; các trường còn lại                                        | `mark`, `anchor`, `screenshot`, `replies` `[{ id, authorKind, authorName, authorMember, deviceHash, visibility, body, createdAt }]` | Duy nhất `(deliverable, seq)` và `(deliverable, clientId)`. Thêm trả lời: `json_insert(replies, '$[#]', json(${JSON.stringify(reply)}))` kèm điều kiện `json_array_length(replies) < 200` (đã thử). `toTarget`, `toMark`, `toAnchor` cũ áp lên JSON đọc ra như trước. |
| AuditLog     | `audit_logs`                | mọi trường                                                                                                                                                                                      | `before`, `after`                                                                                                                   | Ghi bằng `auditStatement` (`src/utils/audit.js`).                                                                                                                                                                                                                     |
| (mới)        | `rate_counters`             |                                                                                                                                                                                                 |                                                                                                                                     | Bộ đếm hạn mức theo khóa nghiệp vụ (mục 6).                                                                                                                                                                                                                           |
| (mới)        | `storage_trash`             |                                                                                                                                                                                                 |                                                                                                                                     | File trên kho chờ xóa (mục 8).                                                                                                                                                                                                                                        |
| (mới)        | `tx_guard` và trigger       |                                                                                                                                                                                                 |                                                                                                                                     | Cơ chế hoàn tác lô (mục 3). Bảng luôn trống.                                                                                                                                                                                                                          |

**Team của đơn (`order_members`).** Một bảng thay cho bốn mảng, nên không còn bước "phản chiếu" (`syncMemberOrders`) và không thể lệch nhau:

- `order.members` (đã populate): `SELECT m.id, m.name, m.email, m.role, m.status, m.skills, om.leader_position FROM order_members om JOIN members m ON m.id = om.member_id WHERE om.order_id = ${id} ORDER BY om.position`.
- `order.leaders` (mảng id): các dòng có `leader_position` không NULL, sắp theo `leader_position`.
- Danh sách đơn của người không phải admin: `o.id IN (SELECT order_id FROM order_members WHERE member_id = ${actor.memberId})`. Không truyền mảng `actor.orderIds` vào SQL.
- Lên admin: `DELETE FROM order_members WHERE member_id = ...`. Xuống viewer: `UPDATE order_members SET leader_position = NULL WHERE member_id = ...`.
- Đổi team (`setOrderMembers`): xóa người bị gỡ, `INSERT ... ON CONFLICT (order_id, member_id) DO UPDATE SET position = excluded.position, leader_position = excluded.leader_position` cho danh sách mới (giữ `created_at` của người ở lại, vì `member.orders` sắp theo `created_at`).
- Khác nhỏ so với cũ: gỡ người khỏi team không còn làm `updatedAt` của đơn đổi ngoài lần `version + 1` của chính thao tác đổi team.

**Tìm kiếm không dấu.** `src/utils/searchText.js`: lúc ghi tính cột tìm kiếm bằng `toSearchText(tên, email, ...)`; lúc tìm dùng `matches(sql.raw("search_text"), query.search)`. Mỗi lần đổi `name` (hay `title`, `contacts`) phải tính lại cột tìm kiếm trong cùng câu UPDATE. Không dùng `LIKE`: D1 giới hạn mẫu LIKE ở 50 byte.

## 3. Thay giao dịch MongoDB bằng batch

D1 không có giao dịch kiểu "mở, đọc, quyết định, ghi, commit". Chỉ có `batch`: một lô câu lệnh chạy nguyên tử và tuần tự; một câu lỗi là cả lô bị hoàn tác (đã thử). Không câu nào của request khác chen được vào giữa lô.

### 3.1 Công cụ (`src/db/d1.js`)

- `guard(câu SELECT, nhãn)`: một câu lệnh đặt trong lô, khẳng định câu SELECT trả ít nhất một dòng. Sai thì trigger trên bảng `tx_guard` ném lỗi và **cả lô bị hoàn tác**. Đúng thì không ghi gì. `guardNot` là ngược lại. (Đã thử: lỗi mang nhãn dạng `TX_GUARD:<nhãn>`; lô có guard sai không để lại thay đổi nào; guard đúng tốn 0 dòng ghi.)
- `transact(plan, { errors, retries })`: chạy hàm `plan` (đọc, kiểm bằng JavaScript, trả `{ statements, done }`), gửi lô, rồi gọi `done(results)`.
  - Guard sai có nhãn nằm trong `errors`: ném ngay lỗi đó.
  - Guard sai khác: chạy lại `plan` từ đầu, tối đa 2 lần nữa, rồi mới ném 409 "Dữ liệu vừa thay đổi. Hãy thử lại.". Lần chạy lại đọc dữ liệu mới nên các câu kiểm trong `plan` tự ra đúng lời báo. Đây là chỗ thay cho việc giao dịch MongoDB tự chạy lại khi đụng nhau.
- `uniqueViolationOf(err)`: nhận ra lỗi trùng khóa duy nhất (cho thao tác idempotent).
- `auditStatement(...)`: câu ghi nhật ký để đặt cuối lô.

### 3.2 Công thức chung

Mỗi hàm cũ dùng `withTransaction` viết lại theo ba bước:

1. **Đọc và kiểm** bằng các truy vấn thường, ngoài lô. Ném `AppError` như cũ, theo đúng thứ tự cũ (thứ tự kiểm quyết định lời báo).
2. **Lô**: đầu lô là guard cho **mọi điều đã đọc ở bước 1 mà quyết định dựa vào**; sau đó các câu ghi không điều kiện; cuối là nhật ký.
3. **Kết quả**: lấy từ `RETURNING` hoặc `changes` của các câu trong lô (`results[i]` ứng với `statements[i]`), hoặc đọc lại sau lô.

Guard nào cho điều gì:

| Điều đã đọc                                              | Guard                                                                                    | Khi sai                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `version` người dùng gửi lên                             | `guard(sql\`SELECT 1 FROM t WHERE id = ${id} AND version = ${input.version}\`, "stale")` | `errors: { stale: STALE }`: 409 ngay                          |
| Trạng thái phải còn nguyên (vòng còn mở, bài còn `done`) | `guard(sql\`SELECT 1 FROM rounds WHERE id = ${id} AND status = 'open'\`, "closed")`      | nhãn riêng với lời báo riêng, hoặc để trống nhãn cho chạy lại |
| Một số đếm chưa vượt trần                                | `guard(sql\`SELECT 1 WHERE (SELECT count(*) FROM ...) < ${MAX}\`)`                       | chạy lại, `plan` tự báo                                       |
| Một thứ phải không tồn tại (file chưa ai dùng)           | `guardNot(sql\`SELECT 1 FROM ...\`)`                                                     | chạy lại, `plan` quyết định lại                               |
| Khóa duy nhất (email, token, số vòng, clientId)          | không cần guard: chỉ mục duy nhất làm lô lỗi                                             | bắt `uniqueViolationOf(err)` quanh `transact`                 |

Vì trạng thái đổi luôn kèm `version + 1` trên cùng bản ghi, guard theo `version` đã bao luôn "trạng thái chưa đổi" của chính bản ghi đó. Chỉ cần guard thêm cho **bản ghi khác** mà quyết định dựa vào.

Ba mẫu hay gặp (đều đã thử trên D1 cục bộ):

```js
// A. Bộ đếm tuần tự: tăng và dùng trong cùng lô. Lô lỗi (trùng clientId) thì bộ đếm cũng hoàn tác.
sql`UPDATE deliverables SET feedback_seq = feedback_seq + 1 WHERE id = ${d.id}`,
Feedback.insert({ ..., seq: sql`(SELECT feedback_seq FROM deliverables WHERE id = ${d.id})` }),

// B. Trạng thái đơn suy ra từ vòng: một câu lệnh đặt SAU các câu đổi vòng (src/services/orderStatusService.js).
syncOrderStatusStatement(orderId),            // trong done: orderStatusOf(results[i])

// C. Số liệu chỉ biết lúc chạy (bao nhiêu nháp được gửi): lấy từ changes của chính câu UPDATE,
//    và ghi vào nhật ký bằng truy vấn con đặt TRƯỚC câu UPDATE đó.
auditStatement({ ..., after: sql`json_object('number', ${round.number}, 'feedback',
  (SELECT count(*) FROM feedback WHERE deliverable_id = ${d.id} AND status = 'draft'))` }),
sql`UPDATE feedback SET status = 'open', ... WHERE deliverable_id = ${d.id} AND status = 'draft'`,   // results[i].changes
```

Luật phải nhớ:

- **Lời gọi ra ngoài (kho file) đặt trước `transact`**, không đặt trong `plan`: `plan` có thể chạy lại. Kết quả của kho giữ ở biến ngoài.
- **Báo trực tiếp (`notifyFeedback`, `disconnect...`) gọi sau khi `transact` xong.**
- Một lô là một lượt đi về tới D1 và tính là **một** truy vấn trong trần 50 truy vấn mỗi request. Nhiều câu đọc độc lập gom bằng `readAll([...])`.
- Mỗi câu tối đa 100 tham số: danh sách dùng `sql.list(mảng)`; chèn nhiều dòng dùng `INSERT ... SELECT ... FROM json_each(${JSON.stringify(dòng)})`.

### 3.3 Chỗ batch không thay được nguyên vẹn

Không có chỗ nào phải bỏ tính nguyên tử. Hai điều khác đi, cần biết:

1. **Lời gọi kho file không còn nằm "trong giao dịch".** Code cũ đã thiết kế để chạy lại được (`staged` trong `attachFile`); bản mới gọi kho trước, lô sau, và file thừa ghi vào `storage_trash` ngay trong lô (mục 8). Kết quả chặt hơn cũ: không còn file mồ côi khi tiến trình chết giữa chừng.
2. **Hết 3 lượt chạy lại thì trả 409.** MongoDB chạy lại gần như không giới hạn. Với tải của một agency (vài người thao tác), 3 lượt là thừa; nếu kiểm thử đồng thời (bấm cùng lúc 10 request) thấy 409 oan thì tăng `retries` ở đúng hàm đó.

### 3.4 Trường "ép đụng nhau" của bản cũ: bỏ

Code cũ ghi `Order.statusSyncedAt`, `Round.lastDraftAt`, `Deliverable.snapshotAt` chỉ để hai giao dịch cùng đọc buộc phải đụng nhau. Lô của D1 là nguyên tử và tuần tự nên không cần:

- `statusSyncedAt`: trạng thái đơn tính bằng SQL ngay trong lô (mẫu B), luôn thấy dữ liệu mới nhất.
- `lastDraftAt`: lô tạo nháp có guard "vòng còn mở"; lô gửi góp ý đổi vòng sang `submitted` rồi mới gom nháp. Hai lô chạy trước sau: nháp hoặc đi cùng lượt gửi, hoặc nhận 409 "Vòng góp ý đã khép...". Không có trường hợp kẹt.
- `snapshotAt` (`lockForSnapshot`): lô mở vòng có guard `version` của sản phẩm chưa đổi. Chiều ngược lại (mở vòng xong trước, rồi mới gỡ file dựa trên lần đọc cũ) do guard của lô gỡ file chặn: `guardNot` "file này không nằm trong vòng nào và không có góp ý nào ghim lên" cho từng file định xóa hẳn.

## 4. Bảng thay từng chỗ `withTransaction`

Backend cũ có **28** chỗ gọi `withTransaction` (lời giao việc ghi 38; đếm bằng `grep` ra 28, ở 7 file service). Cột "Guard" liệt kê guard đặt đầu lô; "nhãn → lời" là guard ném ngay, guard không nhãn là chạy lại.

| #   | File, hàm                               | Guard đầu lô                                                                                                                                                            | Các câu ghi trong lô                                                                                                                                                   | Ghi chú                                                                                                                                                                                                 |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | memberService `createMember`            | không                                                                                                                                                                   | INSERT member, nhật ký                                                                                                                                                 | Trùng email: bắt `uniqueViolationOf` → 409 "Email này đã có trong hệ thống." (vẫn giữ câu kiểm trước).                                                                                                  |
| 2   | memberService `updateMember`            | `stale`; nếu hạ admin đang hoạt động: còn admin hoạt động khác (`lastAdmin` → 409 "Phải còn ít nhất một quản trị viên đang hoạt động.")                                 | UPDATE member (tính lại `search_text` nếu đổi tên); lên admin: DELETE `order_members`; xuống viewer: bỏ `leader_position`; `unassignOpenWorkStatement`; nhật ký        | Sau lô: `disconnectMember` nếu đổi vai trò; đọc lại member kèm `TEAMS_COLUMN` để trả.                                                                                                                   |
| 3   | memberService `suspendMember`           | `stale`; `lastAdmin` như trên                                                                                                                                           | UPDATE status; `destroyAllSessionsStatement`; `unassignOpenWorkStatement`; nhật ký                                                                                     | Sau lô: `disconnectMember`.                                                                                                                                                                             |
| 4   | memberService `activateMember`          | `stale`                                                                                                                                                                 | UPDATE status, nhật ký                                                                                                                                                 |                                                                                                                                                                                                         |
| 5   | clientService `updateClient`            | `stale`                                                                                                                                                                 | UPDATE (tính lại `name_search`, `search_text`), nhật ký                                                                                                                |                                                                                                                                                                                                         |
| 6   | orderService `createOrder`              | khách tồn tại (khi dùng `clientId`); mọi thành viên được chọn vẫn gán được (đếm số người cùng tổ chức, không phải admin, không bị khóa bằng số người chọn)              | INSERT client và nhật ký (khi tạo khách mới); INSERT order; INSERT `order_members` (một câu, `json_each`); nhật ký                                                     | Chèn client trước order (khóa ngoại). Sau lô đọc lại đơn đầy đủ để trả.                                                                                                                                 |
| 7   | orderService `updateOrder`              | `stale`                                                                                                                                                                 | UPDATE (tính lại `title_search`; `deadline` qua `toIso`), nhật ký                                                                                                      | Luật "đơn đang theo vòng thì không đặt tay trạng thái" kiểm ở `plan`; `version` bao luôn vì trạng thái đổi là `version` đổi.                                                                            |
| 8   | orderService `setOrderMembers`          | `stale` (đơn); thành viên vẫn gán được (như #6, trừ người đang ở sẵn trong team)                                                                                        | DELETE người bị gỡ; UPSERT danh sách mới; UPDATE orders `version + 1`; `unassignOpenWorkStatement({ memberIds: bị gỡ, orderId })`; nhật ký                             | Sau lô: `disconnectMember` từng người bị gỡ.                                                                                                                                                            |
| 9   | orderService `deliverOrder`             | `stale`; nếu đơn chưa `approved`: `guardNot` còn sản phẩm đang hoạt động                                                                                                | UPDATE status `delivered`, `delivered_at`, `reopened_at = NULL`; nhật ký                                                                                               | Thêm sản phẩm vào đơn không làm `version` đổi khi trạng thái giữ nguyên, nên cần guard thứ hai.                                                                                                         |
| 10  | orderService `reopenOrder`              | `stale`                                                                                                                                                                 | UPDATE status `in_progress`, `reopened_at`, xóa `delivered_at`, `versions_purged_at`; `syncOrderStatusStatement`; nhật ký với `after` lấy trạng thái bằng truy vấn con | Nhật ký đặt sau câu sync: `after: sql\`json_object('status', (SELECT status FROM orders WHERE id = ${id}))\``.                                                                                          |
| 11  | deliverableService `createDeliverable`  | `orderNotDeliveredGuard`; số sản phẩm hoạt động dưới 20                                                                                                                 | INSERT; nhật ký; `syncOrderStatusStatement`                                                                                                                            |                                                                                                                                                                                                         |
| 12  | deliverableService `updateDeliverable`  | `stale`                                                                                                                                                                 | UPDATE, nhật ký                                                                                                                                                        |                                                                                                                                                                                                         |
| 13  | deliverableService `archiveDeliverable` | `stale`; `orderNotDeliveredGuard`                                                                                                                                       | UPDATE; nhật ký; `syncOrderStatusStatement`                                                                                                                            | Sau lô: `disconnectGuestsOf`.                                                                                                                                                                           |
| 14  | deliverableService `restoreDeliverable` | `stale`; `orderNotDeliveredGuard`                                                                                                                                       | UPDATE; nhật ký; `syncOrderStatusStatement`                                                                                                                            |                                                                                                                                                                                                         |
| 15  | deliverableService `rotateSdkKey`       | `stale`                                                                                                                                                                 | UPDATE, nhật ký                                                                                                                                                        |                                                                                                                                                                                                         |
| 16  | deliverableService `attachFile`         | `stale`; với mỗi file bị thay mà `plan` định **xóa hẳn**: `guardNot` file nằm trong vòng nào, `guardNot` có góp ý ghim lên                                              | UPDATE `files`, `version + 1`; nhật ký; INSERT `storage_trash` cho file xóa hẳn                                                                                        | Hỏi kho, đo, chuyển key chạy **trước** `transact`, giữ kết quả ở biến ngoài. Lô hỏng hẳn thì đưa file vừa chuyển key vào `storage_trash`. Bỏ `freezeLegacyRound`.                                       |
| 17  | deliverableService `removeFile`         | `stale`; nếu định xóa hẳn: hai `guardNot` như #16                                                                                                                       | UPDATE `files`; nhật ký; INSERT `storage_trash` nếu xóa hẳn                                                                                                            |                                                                                                                                                                                                         |
| 18  | feedbackService `createByGuest`         | vòng còn mở (`closed` → 409 "Vòng góp ý đã khép. Chờ team gửi bản sửa để góp ý tiếp.")                                                                                  | mẫu A: tăng `feedback_seq`, INSERT feedback                                                                                                                            | Trùng `clientId`: bắt `uniqueViolationOf`, tìm bài thắng, trả lại (200). Ảnh chụp nhận trước `transact`; lô hỏng thì vào `storage_trash`.                                                               |
| 19  | feedbackService `createByMember`        | không                                                                                                                                                                   | mẫu A; nhật ký (`seq` trong `after` lấy bằng truy vấn con)                                                                                                             | Trùng `clientId` như #18.                                                                                                                                                                               |
| 20  | feedbackService `triage`                | `stale`; nếu giao người: người đó vẫn nhận việc được (không bị khóa, không phải viewer, là admin hoặc có dòng trong `order_members` của đơn)                            | UPDATE, nhật ký                                                                                                                                                        | Sau lô: `notifyFeedback` loại `status`.                                                                                                                                                                 |
| 21  | feedbackService `deleteByMember`        | `stale` theo `version` đã đọc (khách vừa trả lời thì không xóa mất lời của họ)                                                                                          | DELETE; nhật ký; INSERT `storage_trash` nếu có ảnh chụp                                                                                                                |                                                                                                                                                                                                         |
| 22  | roundService `submitByGuest`            | vòng còn mở (`closed` → 409 "Vòng góp ý đã khép..."); có gì để gửi: còn nháp, hoặc có bài bị từ chối trong vòng này (`empty` → 400 "Chưa có góp ý nào để gửi...")       | nhật ký (mẫu C, đặt trước); UPDATE round `submitted` RETURNING; UPDATE nháp thành `open` (lấy `changes`); SELECT đếm bài `reopened`; `syncOrderStatusStatement`        | Guard vòng đặt trước guard nội dung: hai người bấm cùng lúc thì người sau nhận "vòng đã khép". Không cần chạy lại.                                                                                      |
| 23  | roundService `approveByGuest`           | `guardNot` còn nháp (không nhãn: chạy lại, `plan` đếm nháp và báo đúng lời); vòng còn mở (`closed` → 409 "Sản phẩm đã được duyệt hoặc vòng đã khép.")                   | nhật ký (mẫu C); UPDATE round `approved` RETURNING; UPDATE bài `done` thành `confirmed` (lấy `changes`); SELECT đếm bài còn dang dở; `syncOrderStatusStatement`        |                                                                                                                                                                                                         |
| 24  | roundService `openNextRound`            | `version` của sản phẩm chưa đổi và còn hoạt động; `orderNotDeliveredGuard`; vòng mới nhất vẫn là vòng đã đọc, cùng trạng thái                                           | INSERT round (`number` = vòng trước + 1); `syncOrderStatusStatement`; SELECT đếm `pending` theo trạng thái; nhật ký                                                    | Hai người mở cùng lúc: chỉ mục duy nhất `(deliverable, number)` làm lô sau lỗi; bắt `uniqueViolationOf` rồi chạy lại hàm, lần sau báo "Vòng hiện tại còn mở...". Sau lô: `notifyFeedback` loại `round`. |
| 25  | roundService `refreshCurrentRound`      | `version` của sản phẩm; vòng còn mở; `guardNot` có góp ý trên vòng (`touched` → 409 "Khách đã góp ý trên bản này..."); `guardNot` góp ý ghim lên từng file định xóa hẳn | UPDATE round `files`, `url`; UPDATE sản phẩm `files`, `version + 1` (khi có file bị xóa hẳn); nhật ký; INSERT `storage_trash`                                          |                                                                                                                                                                                                         |
| 26  | shareLinkService `createShareLink`      | `version` của sản phẩm (khi link này mở vòng 1); `orderNotDeliveredGuard`; số link còn sống dưới 10                                                                     | INSERT link; INSERT round số 1 (nếu chưa có vòng); `syncOrderStatusStatement`; nhật ký                                                                                 | Hai người tạo link đầu cùng lúc: lô sau lỗi trùng `(deliverable, number)`; bắt rồi chạy lại, lần sau thấy đã có vòng nên chỉ tạo link.                                                                  |
| 27  | shareLinkService `updateShareLink`      | `stale`                                                                                                                                                                 | UPDATE, nhật ký                                                                                                                                                        |                                                                                                                                                                                                         |
| 28  | shareLinkService `changeStatus`         | `stale`                                                                                                                                                                 | UPDATE status (và `revoked_at`), nhật ký                                                                                                                               | Dùng cho tạm dừng, bật lại, thu hồi. Sau thu hồi: `disconnectLink`, rồi đếm link sống và nháp như cũ.                                                                                                   |

Các chỗ ghi có điều kiện **không** dùng `withTransaction` ở bản cũ, chuyển thẳng thành câu `UPDATE ... WHERE <điều kiện>` rồi xem `changes` (0 là thua):

| Hàm                                         | Điều kiện                                                                                                                | Thua thì                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `attachScreenshotByGuest`                   | `screenshot IS NULL`                                                                                                     | đưa ảnh vừa nhận vào `storage_trash`, trả bài đang có. Không tăng `version`.     |
| `updateDraftByGuest`, `deleteDraftByGuest`  | `status = 'draft'`                                                                                                       | 409 như cũ                                                                       |
| `replyByGuest`, `replyByMember`             | `json_array_length(replies) < 200`                                                                                       | 400 "Luồng trao đổi này đã quá dài."                                             |
| `verdictByGuest`                            | lô: guard `status = 'done'`, UPDATE, nhật ký                                                                             | `STALE`. Bản cũ ghi nhật ký riêng; gom vào một lô để nhật ký không lẻ.           |
| `setCurrentPages`                           | lô: guard `status` và `pages_rev` như đã đọc, UPDATE `pages`, `pages_rev + 1`, nhật ký, `storage_trash` cho ảnh hết dùng | 409 "Dữ liệu vừa thay đổi. Hãy thử lại." và đưa ảnh vừa nhận vào `storage_trash` |
| `matchSdkKey`, lượt mở link (`openByToken`) | không                                                                                                                    | ghi thẳng; lượt mở link lỗi thì chỉ ghi log (chạy bằng `runAfterResponse`)       |
| `authService.activateMember`                | đã làm trong lát mẫu bằng `transact`                                                                                     |                                                                                  |

## 5. Kết nối trực tiếp

Hợp đồng phía trình duyệt: `docs/hop-dong-realtime.md`. Phần dưới là phía server (đã viết xong trong khung: `src/realtime/`, `src/utils/realtime.js`).

- **Một Durable Object** `RealtimeHub`, một thể hiện tên `"hub"`, giữ mọi WebSocket bằng Hibernation API. Không chia theo sản phẩm vì một kết nối của thành viên theo dõi tới 30 sản phẩm; chia ra thì mỗi tab phải mở nhiều kết nối. Một object nhận tới 32.768 kết nối, thừa cho một agency.
- **Phòng** là nhãn gắn lúc nhận kết nối (tối đa 10 nhãn mỗi kết nối) và danh sách trong attachment của kết nối:

  | Phòng cũ (Socket.IO) | Bây giờ                                                              |
  | -------------------- | -------------------------------------------------------------------- |
  | `member:<id>`        | nhãn `m:<memberId>`                                                  |
  | `link:<id>`          | nhãn `l:<shareLinkId>`                                               |
  | `d:<id>:customer`    | nhãn `g:<deliverableId>`                                             |
  | `d:<id>:team`        | nhãn `team`, cộng `attachment.watching` chứa id sản phẩm (tối đa 30) |

- **Xác thực lúc mở** do Worker làm (`src/realtime/connect.js`), kết nối hỏng không chạm tới object: kiểm Origin (như Socket.IO cũ: có Origin thì phải nằm trong danh sách), giới hạn 120 lần mở mỗi phút mỗi IP (`SOCKET_LIMITER`), rồi cookie phiên (thành viên) hoặc `?token=` (khách: link tồn tại, chưa thu hồi, sản phẩm chưa lưu trữ). Đạt thì chuyển yêu cầu nâng cấp vào object kèm danh tính; object chỉ giữ **băm** của token phiên.
- **Kiểm lại phiên**: mỗi lệnh `deliverable:watch` đọc lại phiên và quyền `feedback.read` của đơn (như cũ); alarm của object 10 phút một lần kiểm mọi phiên đang nối bằng một truy vấn, phiên hết hạn hoặc tài khoản bị khóa thì đóng với mã 4401.
- **Giới hạn lệnh**: 40 lệnh `deliverable:watch` mỗi 10 giây mỗi kết nối; tin dài quá 1.024 ký tự bị bỏ.
- **Ngắt chủ động** (gọi sau khi lô ghi xong): `disconnectMember(id)` khi đăng xuất, bị khóa, đổi vai trò, bị gỡ khỏi đơn; `disconnectLink(id)` khi thu hồi link; `disconnectGuestsOf(id)` khi lưu trữ sản phẩm. Kết nối đóng với mã 4000.
- **Phát sự kiện**: `notifyFeedback({ deliverableId, feedbackId, kind, visibility, actor })` như cũ. Nội dung `feedback:event` giữ nguyên; phía khách chỉ nhận khi `visibility` là `customer` và `actor` chỉ còn `kind`. Header `X-Socket-Id` giữ nguyên nghĩa: `protect` (và `resolveGuest` của gói khách) gắn `actor.socketId = socketIdOf(c)`, kết nối đó không nhận lại sự kiện do chính nó gây ra.
- Mọi lời gọi sang object chạy **sau khi đã trả lời** (`runAfterResponse`) và nuốt lỗi.
- **Đã thử** (kịch bản tạm, kết nối WebSocket thật vào `wrangler dev`): không cookie nhận lỗi 401 và mã đóng 4401; Origin lạ bị từ chối lúc bắt tay; token link không tồn tại nhận 404 và mã 4404; thành viên nhận `ready` kèm `socketId` 20 ký tự, `ping` ra `pong`, xin theo dõi sản phẩm không tồn tại bị từ chối, id sai dạng bị từ chối, `unwatch` trả ok; đăng xuất thì kết nối đóng với mã 4000; nối lại bằng cookie đã hủy nhận 4401.
- **Chưa thử**: khách nối bằng token thật, phát `feedback:event` tới team và khách, loại trừ theo `X-Socket-Id`, alarm kiểm phiên, object ngủ rồi dậy (máy dev không bao giờ cho object ngủ nên lỗi ngủ đông chỉ lộ trên Cloudflare thật). Gói Y3 và X3 thử khi có link và góp ý.

## 6. Giới hạn tần suất

Code: `src/middleware/rateLimitMiddleware.js`. Hai cơ chế:

**Theo IP: Rate Limiting binding** (khai ở `ratelimits` trong `wrangler.jsonc`). Không tốn lượt ghi D1, có giả lập trong `wrangler dev` (đã thử: header có mặt, bộ Postman chạy qua). Hạn chế: cửa sổ chỉ nhận 10 hoặc 60 giây, và số đếm là gần đúng theo từng điểm hiện diện của Cloudflare. Vì vậy trần đổi từ "mỗi 15 phút" sang "mỗi phút":

| Bộ giới hạn          | Bản cũ (production)    | Bản mới             | Áp ở đâu                                           |
| -------------------- | ---------------------- | ------------------- | -------------------------------------------------- |
| `apiLimiter`         | 600 mỗi 15 phút mỗi IP | 600 mỗi phút mỗi IP | mọi `/api/v1/*` (đã gắn ở `src/app.js`)            |
| `authLimiter`        | 30 mỗi 15 phút         | 10 mỗi phút         | đăng nhập dev, bắt đầu và callback Google (đã gắn) |
| `publicLimiter`      | 300 mỗi 15 phút        | 120 mỗi phút        | mọi `/r/*` (đã gắn ở `src/routes/index.js`)        |
| `guestWriteLimiter`  | 120 mỗi 10 phút        | 60 mỗi phút         | từng route ghi của khách (gói X3, Y4 gắn như cũ)   |
| mở kết nối trực tiếp | 120 mỗi phút           | 120 mỗi phút        | `src/realtime/connect.js`                          |

- Máy dev (`ENVIRONMENT=development`): ba bộ chặt không áp (bản cũ nới gấp 10 để chạy Postman liền nhiều lần); trần chung của API vẫn áp.
- Header: bản cũ trả `RateLimit-Policy` và `RateLimit` (còn lại bao nhiêu). Binding không cho biết số còn lại, nên bản mới chỉ trả `RateLimit-Policy` (Postman chỉ kiểm header này). Vượt trần: 429 với đúng lời cũ, kèm `Retry-After`.
- Khóa là IP trong header `CF-Connecting-IP` (Cloudflare ghi, client không giả được; máy dev là `127.0.0.1`). Không đọc `X-Forwarded-For`.

**Theo khóa nghiệp vụ, cần chính xác: bảng `rate_counters`** qua `countedLimit({ key, limit, windowMs })`. Mỗi lần gọi tốn một dòng ghi D1, nên chỉ dùng cho thao tác thưa. Hiện chỉ có một chỗ: khách xin chỗ đẩy ảnh, 60 lần mỗi link trong 10 phút (gói X3 gắn vào `POST /r/:token/uploads` với `key: (c) => \`upload:${c.req.param("token")}\``). Máy dev nới gấp 10 như cũ.

Hạn mức nằm trong dữ liệu (300 góp ý mỗi link mỗi vòng, 200 trả lời mỗi luồng, 10 link sống, 20 sản phẩm mỗi đơn) vẫn là câu đếm trong service như cũ.

## 7. Việc định kỳ

`src/jobs/index.js`, kích bằng Cron Triggers (giờ UTC). Gói miễn phí cho 5 cron mỗi tài khoản; dùng 2.

| Cron           | Việc                                                                  | Ai viết                          |
| -------------- | --------------------------------------------------------------------- | -------------------------------- |
| `23 * * * *`   | xóa phiên, state OAuth hết hạn, bộ đếm cũ (đã làm)                    | khung                            |
| `23 * * * *`   | dọn `storage_trash`: xóa file trên kho theo lô                        | gói X2, vào `storageJobs.js`     |
| `41 */6 * * *` | dọn file tạm trên kho quá 1 ngày (`purgeStalePending` cũ)             | gói X2, vào `storageJobs.js`     |
| `41 */6 * * *` | dọn bản cũ của đơn bàn giao quá 30 ngày (`purgeDeliveredVersions` cũ) | gói Y4, vào `maintenanceJobs.js` |

- Mỗi lượt cron cũng chỉ có 10 ms CPU và 50 lời gọi ra ngoài. `purgeDeliveredVersions` cũ xử lý 20 đơn mỗi lượt và gọi kho từng file: bản mới **không gọi kho trong việc này**, chỉ sửa D1 và ghi file thừa vào `storage_trash`; mỗi lượt 5 đơn. Việc dọn thùng rác gọi kho theo lô 100 file một lời gọi.
- Luật cũ còn nguyên: khi thử `purgeDeliveredVersions` phải truyền `orderId`.
- Thử trên máy dev khi server đang chạy: `curl "http://127.0.0.1:4000/cdn-cgi/local/scheduled?cron=23+*+*+*+*"` (đã thử, kết quả nằm trong log của `wrangler dev`).

## 8. Kho file: Cloudinary qua HTTP

Gói X2 viết `src/services/storageService.js` (cửa duy nhất, giữ tên hàm cũ) và `src/services/storage/cloudinaryDriver.js`. Không port R2 (để sau); `provider` của file luôn là `"cloudinary"` nhưng vẫn lưu trường này.

Khóa lấy từ `env.CLOUDINARY` (`apiKey`, `apiSecret`, `cloudName`); chưa cấu hình thì `assertStorageEnabled` ném 503 như cũ. Mọi lời gọi đi qua `guarded()` để lỗi kho thành 502 "Kho file đang lỗi, hãy thử lại.".

| Việc cũ (SDK)                                | Gọi HTTP                                                                                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_sign_request(params, secret)`           | Sắp tham số theo tên, nối `k=v` bằng `&`, nối thêm `apiSecret` vào cuối, băm SHA-1 dạng hex. Dùng `createHash("sha1")` của `node:crypto` (đồng bộ).                                                                                                   |
| `createUpload` (cho trình duyệt)             | Không gọi mạng. Trả `uploadUrl` `https://api.cloudinary.com/v1_1/<cloud>/image/upload`, `method` `POST`, `fileField` `file`, `fields` gồm `allowed_formats`, `public_id`, `timestamp`, `type`, `api_key`, `signature` như cũ.                         |
| `uploader.rename` (`promote`)                | `POST https://api.cloudinary.com/v1_1/<cloud>/image/rename`, form: `from_public_id`, `to_public_id`, `type=authenticated`, `timestamp`, `api_key`, `signature` (ký mọi tham số trừ `api_key`).                                                        |
| `uploader.destroy` (`remove`)                | `POST .../image/destroy`, form: `public_id`, `type=authenticated`, `invalidate=true`, `timestamp`, `api_key`, `signature`.                                                                                                                            |
| `api.resource` (`stat`)                      | `GET https://api.cloudinary.com/v1_1/<cloud>/resources/image/authenticated/<public_id>?pages=true`, header `Authorization: Basic base64(apiKey:apiSecret)`. 404 là chưa có file.                                                                      |
| `api.resources` (liệt kê `solaris/pending/`) | `GET .../resources/image/authenticated?prefix=solaris/pending/&max_results=100&next_cursor=...`, Basic.                                                                                                                                               |
| `api.delete_resources`                       | `DELETE .../resources/image/authenticated?public_ids[]=...&invalidate=true`, Basic, tối đa 100 id mỗi lời gọi.                                                                                                                                        |
| `cloudinary.url(..., { sign_url: true })`    | Không gọi mạng. `https://res.cloudinary.com/<cloud>/image/authenticated/s--<chữ ký>--/<biến đổi>/v1/<public_id>.<đuôi>`; chữ ký là 8 ký tự đầu của base64url(SHA-1(`<biến đổi>/<public_id>.<đuôi>` + `apiSecret`)), không có biến đổi thì bỏ đoạn đó. |

- Chuỗi biến đổi phải khớp SDK cũ để URL không đổi: ảnh nhỏ `c_limit,pg_1,q_auto,w_480` đuôi `jpg`; ảnh trang PDF `dn_150,pg_<n>,q_auto` đuôi `jpg`; URL gốc không có biến đổi. **Trước khi tin công thức trên, đối chiếu với SDK thật**: trong repo cũ chạy `node -e` gọi `cloudinary.url(...)` với cùng `public_id` rồi so chuỗi với hàm mới, cho cả ba loại URL. Phiên kiến trúc chưa đối chiếu.
- **Thùng rác kho (`storage_trash`)** thay cho `removeQuietly` gọi thẳng: file thành thừa thì `INSERT INTO storage_trash` ngay trong lô làm nó thừa; sau lô gọi `runAfterResponse(() => emptyTrash(20))` để xóa sớm; cron mỗi giờ quét phần còn lại bằng `delete_resources` theo lô. Xóa xong mới xóa dòng trong bảng. Lợi: nguyên tử với database, và không vượt trần 50 lời gọi ra ngoài.
- **Trần 50 lời gọi ra ngoài mỗi request.** `setCurrentPages` cũ gọi kho 2 lần mỗi ảnh (hỏi rồi chuyển key), 30 trang là 60 lời gọi: vượt trần. Cách xử lý: bỏ bước hỏi riêng, dùng luôn kết quả của `rename` (trả `bytes`, `format`, `width`, `height`; không có file thì 404) rồi mới kiểm loại và cỡ, sai thì đưa vào thùng rác. Còn 30 lời gọi cho 30 trang. Cách này cũng bỏ được lời gọi Admin API (việc P6 treo của bản cũ, Admin API giới hạn 500 lời gọi mỗi giờ). Với PDF cần số trang: nếu `rename` không trả `pages` thì gọi thêm `stat` chỉ cho PDF (mỗi lần đính chỉ một PDF). **Chưa thử với Cloudinary thật**; gói X2 kiểm đầu tiên.
- Luồng ba bước phía trình duyệt, tên key (`pending/<id>/<uuid>.<đuôi>`, `orders/<orderId>/deliverables/<id>/...`), `publicId = "solaris/" + key bỏ đuôi`, các trần dung lượng: giữ nguyên như `storageService.js` và `cloudinaryDriver.js` cũ.

## 9. Một Worker: cấu hình, đăng nhập, lỗi, log, frontend

**Cấu hình** (`src/config/env.js`, kiểm bằng zod lúc nạp; sai thì Worker không khởi động và báo rõ biến nào).

| Biến                                       | Bản deploy                                  | Máy dev       | Ghi chú                                                                                                 |
| ------------------------------------------ | ------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`                              | `vars`: `production`                        | `development` | Thay `NODE_ENV`. Trong code dùng `env.IS_DEV`.                                                          |
| `OWNER_EMAIL`                              | `wrangler secret put`                       | `.dev.vars`   | Bắt buộc.                                                                                               |
| `CLIENT_ORIGINS`                           | `vars`: địa chỉ `https://<tên>.workers.dev` | `.dev.vars`   | Origin đầu là `env.FRONTEND_URL`: gốc của link chia sẻ, đoạn nhúng, nơi chuyển về sau đăng nhập Google. |
| `SESSION_HOURS`, `LOG_LEVEL`               | `vars`                                      | `.dev.vars`   |                                                                                                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `wrangler secret put`                       | `.dev.vars`   | Cùng có hoặc cùng trống. Trống thì đăng nhập Google trả 503.                                            |
| `CLOUDINARY_URL`                           | `wrangler secret put`                       | `.dev.vars`   | Trống thì API file trả 503.                                                                             |
| `API_PUBLIC_URL`, `COOKIE_DOMAIN`          | để trống                                    | tùy           | Một Worker một địa chỉ nên không cần.                                                                   |

Bỏ hẳn: `PORT`, `HOST`, `MONGODB_*`, `FRONTEND_DIST`, `STORAGE_DRIVER`, `R2_*`. `.dev.vars` không commit; không in giá trị ra màn hình hay tài liệu.

**Origin được tin**: `CLIENT_ORIGINS` cộng chính origin của request (bản deploy phục vụ frontend và API cùng địa chỉ). Áp cho CORS, chống CSRF (`requireTrustedOrigin`) và bắt tay WebSocket.

**Cookie phiên** `solaris_sid`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` khi không phải máy dev, sống `SESSION_HOURS`. Token 32 byte ngẫu nhiên, D1 giữ băm SHA-256. Mỗi request có đăng nhập tốn đúng **một** truy vấn (phiên, thành viên và các đơn tham gia trong một câu).

**Chủ hệ thống** (`ensureOwner`): Worker không có lúc khởi động để hỏi database, nên chạy ở request đầu tiên của mỗi isolate vào `/auth/*`. Database trống thì tạo tổ chức "Công ty" và chủ hệ thống (admin, `invited`); chủ bị hạ quyền hay bị khóa thì khôi phục và gỡ khỏi mọi team.

**Đăng nhập dev**: bật khi `ENVIRONMENT=development` **và** tên miền của request là loopback **và** header `Host` là loopback **và** `CF-Connecting-IP` là loopback **và** không có header chuyển tiếp. Trên Cloudflare, tên miền của request không bao giờ là loopback, nên lỡ đặt `ENVIRONMENT=development` ở bản deploy thì cửa này vẫn đóng (trả 404 "Không tìm thấy." như cũ). Qua Vite proxy (`changeOrigin: false`) vẫn chạy vì Host là `localhost:5173`.

**Đăng nhập Google** bằng `fetch`: mã ủy quyền kèm PKCE (S256), state dùng một lần (xóa và đọc `code_verifier` trong một câu `DELETE ... RETURNING`), đổi mã ở `oauth2.googleapis.com/token`, kiểm chữ ký RS256 của `id_token` bằng khóa công khai của Google (Web Crypto), kiểm người phát hành, audience, hạn. Luật cấp quyền như cũ. **Đã thử**: chuyển sang Google đúng tham số; callback với state lạ và với `error` chuyển về `/login?error=...`. **Chưa thử**: đăng nhập Google thật tới cùng (cần trình duyệt và redirect URI đăng ký đúng địa chỉ).

**Lỗi**: `throw new AppError(lời, mã)` ở bất kỳ đâu; `app.onError` trả `{ status: "fail" | "error", message }`. Lỗi D1 trùng khóa duy nhất thành 409 "Dữ liệu bị trùng (cột). Hãy thử lại!"; guard sai lọt ra ngoài thành 409; lỗi khác thành 500 "Có lỗi, hãy thử lại." (máy dev kèm `detail`). Không route nào khớp: 404 "Không tìm thấy <đường dẫn> trên server.". Body quá 100 KB (1 MB cho bộ ảnh trang): 413. JSON hỏng: 400.

**Header**: mọi response của API mang bộ header bảo mật của helmet cũ, `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`, và CORS chỉ cho origin được tin.

**Log**: `logger.info({ ... }, "lời")` ra JSON một dòng (Workers Logs khi deploy, màn hình `wrangler dev` khi dev). Mỗi request một dòng: phương thức, đường dẫn đã che token của link, mã trả về, mili giây. Không ghi cookie, token, email, nội dung góp ý. `console.log` bị ESLint chặn ngoài `logger.js`.

**Frontend và trang demo**: `npm run sync-frontend` chép `../Solaris FE/dist` (đã gồm `bridge.js` và `demo-site/`) vào `frontend-dist/` và sinh file `_headers` (thư mục `assets/` giữ lâu; `bridge.js` cho site khác nạp). File tĩnh không mang CSP của API, nên trang review nhúng được site của khách. Khi dev vẫn chạy Vite ở 5173 và proxy `/api` sang 4000 như cũ; **proxy `/api` phải bật `ws: true`** cho kết nối trực tiếp, và bỏ mục `/socket.io`. Chưa thử phục vụ bản build thật qua Worker (mới có trang giữ chỗ).

## 10. Giới hạn gói miễn phí

| Giới hạn                                                                                          | Ảnh hưởng                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10 ms CPU mỗi request và mỗi lượt cron (thời gian chờ D1, fetch không tính; **máy dev không áp**) | Rủi ro lớn nhất, xem dưới.                                                                                                                                                    |
| 100.000 request Worker mỗi ngày                                                                   | Chỉ `/api/*` tính; file tĩnh không tính. Hết thì `/api/*` trả 429 tới 0 giờ UTC.                                                                                              |
| 50 lời gọi ra ngoài mỗi request                                                                   | Kho file: xem mục 8.                                                                                                                                                          |
| D1: 50 truy vấn mỗi request (một lô tính là một)                                                  | Đường khách mở link cũ đã về 8 lệnh. Gom đọc bằng `readAll`.                                                                                                                  |
| D1: 100.000 dòng ghi, 5 triệu dòng đọc mỗi ngày                                                   | Mỗi cột có chỉ mục tính thêm một dòng ghi. Tránh câu quét cả bảng: mọi WHERE phải dùng được chỉ mục trong `0001_init.sql`. Vượt thì mọi truy vấn lỗi tới 0 giờ UTC.           |
| D1: 100 tham số mỗi câu, 2 MB mỗi dòng                                                            | `sql.list`, `json_each`. Luồng 200 trả lời, mỗi trả lời 4.000 ký tự, tệ nhất gần 2 MB: nếu câu thêm trả lời lỗi vì dòng quá lớn thì trả 400 "Luồng trao đổi này đã quá dài.". |
| Durable Object: 100.000 request mỗi ngày                                                          | Mỗi `notifyFeedback`, mỗi lần mở kết nối, mỗi 20 tin từ trình duyệt tính một request. Kết nối đang ngủ không tốn.                                                             |

**Chỗ nào của code cũ dễ vượt 10 ms CPU, và cách xử lý:**

| Chỗ                                                                                             | Vì sao tốn                                                  | Xử lý                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf-lib`, `image-size` (đo file ở server)                                                      | phân tích file nhị phân                                     | Chỉ driver R2 dùng. Cloudinary tự đo, nên **không port**. Khi làm R2 sau này: đo ở trình duyệt hoặc trả phí.                                                                                  |
| Ký URL Cloudinary: mỗi file có `url`, `thumbUrl`, PDF thêm tới 100 `pageUrls`, lặp qua mọi vòng | hàng trăm phép băm SHA-1 mỗi response                       | Băm đồng bộ bằng `node:crypto` (không dùng `crypto.subtle`, mỗi lần là một vòng chờ); nhớ kết quả trong một `Map` cấp module theo `(public_id, biến đổi)` vì chữ ký không đổi theo thời gian. |
| Danh sách 500 góp ý kèm trả lời, nét vẽ 2.000 điểm                                              | `JSON.parse` từng cột JSON rồi `JSON.stringify` cả response | Giữ trần 500 và cờ `truncated`. Câu SELECT cho danh sách chỉ lấy cột cần. Đo trên Cloudflare thật ở ngày 3 với 500 bài; nếu vượt thì hạ trần (cần chủ dự án duyệt vì đổi hành vi).            |
| `GET /orders/:id/deliverables` (mọi sản phẩm, mọi vòng, mọi file)                               | nhiều URL ký và JSON lồng                                   | Như hai dòng trên; đọc vòng của cả đơn bằng một truy vấn như cũ.                                                                                                                              |
| zod với body lớn (1 MB bộ ảnh trang)                                                            | duyệt 30 trang, mỗi trang 300 ghim                          | Chấp nhận; đo ở ngày 3.                                                                                                                                                                       |
| Băm mật khẩu                                                                                    |                                                             | Hệ thống không có mật khẩu.                                                                                                                                                                   |

Lát mẫu (đăng nhập, `me`) chỉ làm vài phép băm và một hai truy vấn, không đáng lo. Không đo được CPU thật trên máy dev.

## 11. Cấu trúc thư mục, quy ước code, mẫu

Giữ `docs/quy-uoc-code.md` của backend cũ (đặt tên, định dạng response, controller mỏng, luật ở service, chú thích tiếng Việt nói "vì sao", Prettier và ESLint như cũ). Chỗ đổi:

| Bản cũ                                                    | Bản mới                                                                                                      | Vì sao                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| CommonJS (`require`, `module.exports`)                    | ES modules: `import`, `export`; đường dẫn import phải có đuôi `.js`                                          | Worker chạy ES modules                      |
| `(req, res, next)`, `catchAsync`                          | `async (c) => c.json(...)`; lỗi cứ `throw`, không cần `catchAsync`                                           | Hono                                        |
| `req.body`, `req.valid.params`, `req.actor`, `req.member` | `c.get("valid").body`, `c.get("valid").params`, `c.get("valid").query`, `c.get("actor")`, `c.get("member")`  |                                             |
| `res.status(201).json(x)`                                 | `return c.json(x, 201)`                                                                                      |                                             |
| `require("../config/env")`                                | `import env from "../config/env.js"`                                                                         |                                             |
| Model Mongoose, `.find().lean()`                          | SQL viết bằng thẻ `sql`, đổi dòng thành object bằng `Model.fromRow`                                          | không ORM                                   |
| `mongoose.trusted(...)`, `sanitizeFilter`                 | mọi giá trị vào SQL qua `${...}` của thẻ `sql` (thành tham số ràng buộc); `sql.raw` chỉ cho chữ do code viết | chống SQL injection                         |
| `withTransaction(async (session) => ...)`                 | `transact(async () => ({ statements, done }))`                                                               | mục 3                                       |
| `logAudit(entry, session)`                                | `auditStatement(entry)` đặt trong lô; `logAudit(entry)` khi ghi lẻ                                           |                                             |
| `route.use(authCtrl.protect)` đầu mỗi file route          | `protect` đã gắn theo tiền tố ở `routes/index.js`; file route không gọi lại                                  | nhiều file route chung một tiền tố (mục 12) |
| `Promise.all` nhiều truy vấn đọc                          | `readAll([...])`                                                                                             | một lượt đi về, tính một truy vấn           |
| `notifyFeedback` gọi thẳng                                | cùng tên, tự chạy sau response                                                                               |                                             |
| `storage.removeQuietly(file)`                             | ghi vào `storage_trash` trong lô                                                                             | mục 8                                       |

```
wrangler.jsonc            cấu hình Worker (D1, Durable Object, assets, cron, giới hạn tần suất)
migrations/               lược đồ D1, mỗi thay đổi một file mới
scripts/                  prepare-dev.mjs (chạy trước npm run dev), sync-frontend.mjs
frontend-dist/            bản build frontend (không commit)
src/index.js              điểm vào: fetch, scheduled, export RealtimeHub
src/app.js                dựng Hono: middleware, /api/v1, lỗi
src/config/env.js         kiểm cấu hình bằng zod
src/db/d1.js              thẻ sql, first, all, run, readAll, batch, guard, transact
src/db/model.js           defineModel (đổi tên cột, JSON, boolean)
src/models/               khai báo bảng (thay cho model Mongoose)
src/routes/               mỗi nghiệp vụ một file; index.js gắn tất cả
src/controllers/          mỏng; errorController.js, authController.js (protect, restrictTo)
src/services/             luật nghiệp vụ, SQL, transact
src/validators/           schema zod; common.js có objectIdSchema, versionOnlySchema, tokenParams
src/middleware/           validate, đọc body, bảo mật và Origin, giới hạn tần suất
src/policies/policy.js    can, assertCan, isLeaderOf, levelOf (chép nguyên)
src/realtime/             Durable Object và bắt tay WebSocket
src/jobs/                 việc định kỳ
src/utils/                appError, audit, id, time, hash, searchText, pagination, logger, realtime, background, enums
docs/                     tài liệu này, hop-dong-realtime.md, tien-do.md
```

### Mẫu route

```js
// src/routes/memberRoutes.js
import * as authCtrl from "../controllers/authController.js";
import * as memberCtrl from "../controllers/memberController.js";
import validate from "../middleware/validateMiddleware.js";
import {
  memberIdParams,
  updateMemberSchema,
} from "../validators/memberValidator.js";

route.use(authCtrl.restrictTo("admin"));

route.patch(
  "/:id",
  validate({ params: memberIdParams, body: updateMemberSchema }),
  memberCtrl.updateMember
);
```

### Mẫu controller

```js
// src/controllers/memberController.js
import * as memberService from "../services/memberService.js";

export const updateMember = async (c) => {
  const { params, body } = c.get("valid");
  const member = await memberService.updateMember(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { member },
  });
};
```

### Mẫu service: đọc, và ghi có giao dịch

```js
// src/services/memberService.js
import { all, first, guard, sql, transact } from "../db/d1.js";
import Member, { TEAMS_COLUMN, toMember } from "../models/memberModel.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { matches, toSearchText } from "../utils/searchText.js";
import { now } from "../utils/time.js";
import { assertCan } from "../policies/policy.js";

async function findTarget(actor, id) {
  const member = toMember(
    await first(sql`
      SELECT m.*, ${TEAMS_COLUMN} FROM members m
      WHERE m.id = ${id} AND m.org_id = ${actor.orgId}`)
  );
  if (!member) throw new AppError("Không tìm thấy thành viên.", 404);
  return member;
}

// Danh sách: điều kiện dựng dần, mọi giá trị là tham số ràng buộc.
export async function listMembers(actor, query = {}) {
  assertCan(actor, "member.manage");
  const where = [sql`m.org_id = ${actor.orgId}`];
  if (query.role) where.push(sql`m.role = ${query.role}`);
  if (query.status) where.push(sql`m.status = ${query.status}`);
  if (query.search) where.push(matches(sql.raw("m.search_text"), query.search));
  const rows = await all(sql`
    SELECT m.*, ${TEAMS_COLUMN} FROM members m WHERE ${sql.and(where)} ORDER BY m.name`);
  return rows.map(toMember).map(toPublic);
}

// Ghi: đọc và kiểm, rồi một lô có guard.
export async function activateMember(actor, id, input) {
  assertCan(actor, "member.manage");
  return transact(
    async () => {
      const target = await findTarget(actor, id);
      if (target.version !== input.version) throw STALE();
      if (target.status !== "suspended") {
        throw new AppError("Tài khoản không bị tạm khóa.", 409);
      }
      const status = target.googleSub ? "active" : "invited";
      return {
        statements: [
          guard(
            sql`SELECT 1 FROM members WHERE id = ${id} AND version = ${input.version}`,
            "stale"
          ),
          sql`UPDATE members SET ${Member.set({ status, updatedAt: now() })}, version = version + 1
              WHERE id = ${id} RETURNING *`,
          auditStatement({
            actor,
            action: "member.activate",
            entityType: "member",
            entityId: id,
            before: { status: "suspended" },
            after: { status },
          }),
        ],
        // results[1] là kết quả của câu UPDATE. Dòng trả về không có cột teams, nên ghép lại từ bản đã đọc.
        done: (results) =>
          toPublic({ ...target, ...Member.fromRow(results[1].rows[0]) }),
      };
    },
    { errors: { stale: STALE } }
  );
}
```

Chèn bản ghi mới: `Member.insert({ id: newId(), org: actor.orgId, ..., searchText: toSearchText(name, email), createdAt: at, updatedAt: at })` với `const at = now()`.

Mẫu thật đang chạy: `src/services/authService.js` (đọc một truy vấn, `transact` có guard, `DELETE ... RETURNING`, chèn có `ON CONFLICT`), `src/controllers/authController.js`, `src/routes/authRoutes.js`.

### Bẫy khi chép code cũ

- `String(a) === String(b)` để so id: giờ id là chuỗi sẵn, so thẳng. `new mongoose.Types.ObjectId(x)`: bỏ.
- `doc.field || null` cho trường không có: dòng D1 trả `null` sẵn cho cột trống, nhưng JSON lồng (`file.width`, `anchor.selector`) vẫn có thể thiếu khóa: giữ các `|| null` của `toPublic` cũ.
- `$unset`: đặt cột bằng `null` (`Model.set({ assignee: null })`). `$inc`: `x = x + 1` viết thẳng trong SQL.
- `countDocuments`: `SELECT count(*) AS n`. `exists`: `SELECT 1 ... LIMIT 1`.
- `.sort({ _id: -1 })`: `ORDER BY id DESC`. `.sort({ role: 1, name: 1 })`: `ORDER BY role, name`.
- `localeCompare(b, "vi")` trong JS (ví dụ `listAssignableMembers`): giữ nguyên trong JS, không đẩy xuống SQL.
- Câu SELECT cho danh sách đừng lấy cột JSON lớn không dùng (`replies`, `pages`, `files`).
- Mọi `Date` trả ra: đã là chuỗi ISO. So thời gian trong JS: `new Date(x).getTime()` như cũ vẫn đúng.

## 12. Kế hoạch chia việc

Hai phiên code, gọi là **X** và **Y**. Mỗi gói có danh sách file riêng; **không sửa file ngoài danh sách của mình**. File dùng chung (dưới) cần sửa thì nhắn phiên điều phối.

**File dùng chung, đã có, không phiên nào sửa:** `wrangler.jsonc`, `migrations/0001_init.sql`, `src/index.js`, `src/app.js`, `src/routes/index.js`, `src/routes/authRoutes.js`, `src/config/`, `src/db/`, `src/models/`, `src/middleware/`, `src/policies/`, `src/realtime/`, `src/utils/`, `src/jobs/index.js`, `src/controllers/errorController.js`, `src/controllers/authController.js`, `src/services/authService.js`, `src/services/orderStatusService.js`, `src/services/unassignService.js`, `src/services/feedbackRules.js`, `src/validators/common.js`, `src/validators/authValidator.js`.

File route và file job của mọi gói **đã được tạo sẵn (rỗng) và đã gắn** trong `routes/index.js` và `jobs/index.js`: chỉ việc điền.

| Gói | Phiên          | Ngày      | Nội dung                                                                                           | File của gói (trong `src/`)                                                                                                                                                                                                                      | Thư mục Postman                             | Cần trước                                                            |
| --- | -------------- | --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------- |
| X1  | X              | 1         | Thành viên: danh sách, cấp quyền, sửa, khóa, mở khóa                                               | `routes/memberRoutes.js`, `controllers/memberController.js`, `services/memberService.js`, `validators/memberValidator.js`                                                                                                                        | 02                                          | khung                                                                |
| Y1  | Y              | 1         | Khách hàng; đơn hàng: tạo, danh sách, chi tiết, sửa, team, người gán được, bàn giao, mở lại        | `routes/clientRoutes.js`, `routes/orderRoutes.js`, `controllers/clientController.js`, `controllers/orderController.js`, `services/clientService.js`, `services/orderService.js`, `validators/clientValidator.js`, `validators/orderValidator.js` | 03 (cần thành viên thử của nhóm 02, tức X1) | khung                                                                |
| X2  | X              | 1 cuối, 2 | Sản phẩm bàn giao; kho file Cloudinary qua HTTP; upload ba bước; việc định kỳ của kho              | `routes/deliverableRoutes.js`, `controllers/deliverableController.js`, `services/deliverableService.js`, `services/storageService.js`, `services/storage/cloudinaryDriver.js`, `validators/deliverableValidator.js`, `jobs/storageJobs.js`       | 04, 10                                      | Y1 (đơn)                                                             |
| Y2  | Y              | 1 cuối    | Nhật ký hoạt động của đơn                                                                          | `routes/activityRoutes.js`, `controllers/activityController.js`, `services/activityService.js`, `validators/activityValidator.js`                                                                                                                | (trong 12)                                  | Y1                                                                   |
| Y3  | Y              | 2         | Link chia sẻ; vòng 1; khách mở link (`GET /r/:token`); ngữ cảnh khách (`resolveGuest`)             | `routes/shareLinkRoutes.js`, `routes/publicRoutes.js`, `controllers/shareLinkController.js`, `middleware/guestMiddleware.js` (file mới của gói), `services/shareLinkService.js`, `validators/shareLinkValidator.js`                              | 05                                          | X2 (phần đọc: `toPublicDeliverable`, `activeFiles`, `isRetained`)    |
| X3  | X              | 2         | Góp ý của khách: nháp, sửa, xóa, ảnh chụp, trả lời, xác nhận, kiểm khóa nhúng                      | `routes/publicFeedbackRoutes.js`, `controllers/guestController.js`, `services/feedbackService.js` (phần khách), `validators/feedbackValidator.js`                                                                                                | 06, 13                                      | Y3 (`guestMiddleware`, link, vòng 1), X2                             |
| X4  | X              | 2         | Góp ý phía team: danh sách, tạo, xử lý, trả lời, xóa, kiểm khóa nhúng                              | `routes/feedbackRoutes.js`, `controllers/feedbackController.js`, `services/feedbackService.js` (phần team)                                                                                                                                       | 06, 07 (phần team)                          | X3                                                                   |
| Y4  | Y              | 2         | Vòng review: khách gửi, duyệt; mở vòng kế; cập nhật bản đang gửi; ảnh trang; dọn bản cũ            | `routes/roundRoutes.js`, `routes/publicRoutes.js` (thêm submit, approve), `controllers/roundController.js`, `services/roundService.js`, `services/maintenanceService.js`, `validators/roundValidator.js`, `jobs/maintenanceJobs.js`              | 07, 11, 12                                  | Y3, X2; đếm góp ý bằng SQL trực tiếp, không import `feedbackService` |
| Thử | phiên kiểm thử | 1 đến 3   | Chạy Postman theo nhóm khi gói xong; ngày 3 chạy cả 406 request và các kịch bản trong `qa-scripts` | không sửa `src/`                                                                                                                                                                                                                                 | tất cả                                      |                                                                      |
| FE  | phiên frontend | 2         | Thay `socket.io-client` theo `docs/hop-dong-realtime.md`; Vite proxy `ws: true`                    | repo `Solaris FE`                                                                                                                                                                                                                                |                                             | khung (đã đủ)                                                        |

Phụ thuộc chéo và cách không phải chờ nhau:

- **`deliverableService` (X2) được Y3 và Y4 import.** X2 làm phần đọc trước (`activeFiles`, `isRetained`, `toPublicFile`, `toPublicPages`, `buildVersions`, `toPublic`) và commit sớm, rồi mới làm phần ghi và kho file.
- **`guestMiddleware.js` (Y3)** xuất `resolveGuest` (gắn `c.get("guest")` = `{ link, deliverable, round, order, orderStatus, deviceHash, actor }`, `actor.socketId = socketIdOf(c)`) và `requireDevice`. Y3 làm file này đầu tiên của ngày 2 để X3 dùng.
- **`feedbackService.js` do X giữ cả hai phần** (X3 rồi X4, cùng một phiên nên không đụng nhau). Y4 không import file này: luật chung đã nằm ở `feedbackRules.js`; chỗ cần đếm góp ý thì viết SQL.
- **`publicRoutes.js`** do Y3 tạo nội dung, Y4 thêm hai route; cùng phiên Y.
- Route ghi của khách gắn `guestWriteLimiter` ở từng route như cũ (import từ `rateLimitMiddleware.js`).
- Validator của ảnh trang và ảnh chụp trang (`shots`, `pages`) nằm ở `roundValidator.js` (Y4), không nằm ở `deliverableValidator.js` như cũ.
- `GET /orders/:id/deliverables` và `POST /orders/:id/deliverables` thuộc X2 (`orderDeliverableRoutes`); `GET /orders/:id/feedback` thuộc X4 (`orderFeedbackRoutes`).

Thứ tự theo ngày:

- **Ngày 1**: X1 và Y1 song song. Xong thì chạy Postman 01, 02, 03, 08, 09. Cuối ngày X bắt đầu phần đọc của X2, Y làm Y2.
- **Ngày 2**: X2 (ghi và kho) và Y3 song song; rồi X3 và Y4 song song; rồi X4. Phiên frontend đổi kết nối trực tiếp. Postman 04, 05, 06, 07, 10, 11, 12, 13.
- **Ngày 3**: cả 406 request; kịch bản đồng thời trong `qa-scripts` (đổi `socket.io-client` sang WebSocket thường ở các kịch bản chat); thử cron; build frontend vào Worker; chủ dự án đăng nhập `wrangler`, tạo D1, đặt khóa bí mật, deploy; đo CPU thật.

Mỗi gói xong khi: Postman của gói qua trên `http://127.0.0.1:4000`, `npm run lint` sạch, đã ghi vào `docs/tien-do.md` phần đã thử và chưa thử, đã commit file của gói.

## 13. Rủi ro và câu hỏi cần chủ dự án quyết

Phần đã chốt (CLAUDE.md) không nằm ở đây. Dưới là điều phát sinh khi thiết kế.

**Rủi ro, xếp theo mức:**

1. **10 ms CPU trên gói miễn phí chưa đo được.** Máy dev không áp giới hạn này. Các response nặng (danh sách 500 góp ý, sản phẩm nhiều vòng nhiều file) có thể vượt; khi vượt Cloudflare trả lỗi 1102 cho request đó. Cách giảm đã ghi ở mục 10. Chỉ biết chắc khi deploy và đo. Lối thoát nếu vượt: Workers Paid (5 USD mỗi tháng, CPU 30 giây), không phải sửa code.
2. **Rate Limiting binding trên gói miễn phí.** Tài liệu Cloudflare ghi binding đã phát hành chính thức nhưng không nói rõ gói miễn phí dùng được không. Máy dev chạy được. Nếu ngày deploy bị từ chối: bỏ mục `ratelimits` (middleware tự bỏ qua khi thiếu binding) và chuyển các trần theo IP sang `countedLimit` (tốn dòng ghi D1), hoặc chấp nhận chỉ còn hạn mức theo dữ liệu.
3. **Guard bằng trigger mới thử trên D1 cục bộ.** D1 thật dùng cùng bộ máy SQLite nên nhiều khả năng giống, nhưng phải thử ngay sau lần deploy đầu (một request sửa với `version` cũ phải ra 409 và không ghi gì). Nếu D1 thật không nhận `RAISE` kèm biểu thức: đổi trigger sang lời cố định `'TX_GUARD:'` (mất nhãn, mọi guard sai thành chạy lại rồi 409).
4. **Cloudinary qua HTTP chưa chạy thật.** Công thức ký URL, kết quả của `rename`, xóa theo lô: mới theo tài liệu và code SDK cũ. Gói X2 đối chiếu với SDK thật trước khi làm tiếp.
5. **Durable Object ngủ đông không tái hiện được trên máy dev.** Code không giữ trạng thái trong biến của class (trừ bộ đếm lệnh, mất cũng không sao), nhưng lỗi kiểu này chỉ lộ trên Cloudflare.
6. **Hạn mức ngày của D1** (100.000 dòng ghi): mỗi lần ghi một bản ghi có nhiều chỉ mục tính nhiều dòng (bảng `feedback` có 7 chỉ mục). Với một agency thì xa trần; chạy cả bộ Postman nhiều lần trên D1 thật trong một ngày thì nên để ý.
7. **`*.workers.dev` và cookie**: một địa chỉ cho cả frontend và API nên cookie `SameSite=Lax` chạy đúng. Redirect URI của Google phải thêm địa chỉ workers.dev.

**Câu hỏi cần chủ dự án quyết** (không chặn ngày 1 và 2; cần trước ngày deploy):

1. **Trần tần suất đổi từ "mỗi 15 phút" sang "mỗi phút"** (bảng ở mục 6) vì binding chỉ có cửa sổ 10 hoặc 60 giây, và bỏ header `RateLimit` (số còn lại). Đề xuất: chấp nhận. Muốn giữ đúng cửa sổ 15 phút thì phải đếm trong D1 ở mọi request, tốn khoảng một dòng ghi mỗi request.
2. **Nếu đo ra vượt 10 ms CPU**: trả 5 USD mỗi tháng cho Workers Paid, hay hạ trần danh sách (500 góp ý xuống thấp hơn) và chấp nhận đổi hành vi?
3. **Xóa file trên kho chậm hơn**: file thừa giờ vào thùng rác và được xóa sau response hoặc trong vòng một giờ, thay vì xóa ngay trong request. Người dùng không thấy khác. Đề xuất: chấp nhận.
4. **Ba khóa đã lộ** (Google client secret, Cloudinary API secret, và mật khẩu Atlas không còn dùng): vẫn nên đổi trước khi deploy; khóa mới đặt bằng `wrangler secret put`, không ghi vào file nào.
