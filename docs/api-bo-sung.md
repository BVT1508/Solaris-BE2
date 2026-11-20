# API bổ sung của bản Cloudflare

Hợp đồng API gốc nằm ở `Solaris BE/docs/api-gop-y.md` và giữ nguyên. File này ghi các đường và hành vi **chỉ bản Cloudflare có**. Quy ước chung (cookie phiên, phong bì `{ status, data }`, lỗi `{ status: "fail", message }`, header `Cache-Control: no-store`) như mọi route khác.

## Tạm ngừng khi sắp hết hạn mức: 503 `quota_paused`

Khi một chỉ số của gói miễn phí đạt ngưỡng tạm ngừng trong ngày (mặc định 97% của trần, biến `USAGE_PAUSE_PERCENT`), hoặc khi chính D1 báo tài khoản đã chạm trần ngày, **mọi đường API ngoài danh sách cho phép** trả:

```
HTTP 503
Retry-After: <số giây tới 00:00 UTC kế tiếp>
Cache-Control: no-store
```

```json
{
  "status": "fail",
  "code": "quota_paused",
  "message": "Hệ thống tạm ngừng vì đã dùng hết lưu lượng miễn phí của hôm nay. Hoạt động lại lúc 07:00 (giờ Việt Nam).",
  "data": { "resetAt": "2026-11-22T00:00:00.000Z" }
}
```

- Đây là chỗ duy nhất response lỗi có trường `code`. Frontend nhận ra bằng `status === 503 && body.code === "quota_paused"` rồi hiện màn báo hết lưu lượng (cho cả thành viên lẫn khách mở link), kèm giờ hoạt động lại lấy từ `data.resetAt`.
- Vẫn phục vụ lúc tạm ngừng: `GET /auth/me`, `POST /auth/logout`, `GET /auth/google`, `GET /auth/google/callback`, `GET /usage`, `GET /infrastructure`. Nhờ đó quản trị viên vẫn đăng nhập và xem trang hạ tầng được.
- Giao diện (file tĩnh) vẫn tải được lúc tạm ngừng: nó không đi qua Worker.
- Kết nối trực tiếp (`GET /api/v1/realtime`) bị từ chối với cùng `code`: xem `docs/hop-dong-realtime.md` (mã đóng 4503).
- Sang ngày mới theo UTC (07:00 giờ Việt Nam) hệ thống tự hoạt động lại.
- Cloudflare chạy nhiều tiến trình của Worker song song. Từ lúc mức dùng vượt ngưỡng tới lúc MỌI tiến trình cùng chặn mất nhiều nhất khoảng 30 giây; trong khoảng đó cùng một lời gọi có thể lúc 200 lúc 503. Frontend nên coi lần 503 `quota_paused` đầu tiên là tín hiệu chuyển sang màn tạm ngừng và giữ màn đó, không quay lại vì một lời gọi khác vừa 200.

## GET /api/v1/usage

Mức dùng gói miễn phí của Cloudflare trong ngày hiện tại (ngày tính theo UTC).

- Quyền: chỉ quản trị viên. Chưa đăng nhập: 401 "Bạn chưa đăng nhập hoặc phiên đã hết hạn.". Vai trò khác: 403 "Bạn không có quyền làm việc này.".
- Không có tham số. Vẫn phục vụ lúc tạm ngừng.

Trả 200:

```json
{
  "status": "success",
  "data": {
    "usage": {
      "day": "2026-11-21",
      "resetAt": "2026-11-22T00:00:00.000Z",
      "estimated": true,
      "level": "warning",
      "metrics": [
        {
          "key": "requests",
          "label": "Lượt request vào Worker",
          "used": 12345,
          "limit": 100000,
          "percent": 12.3,
          "level": "ok"
        },
        {
          "key": "rowsWritten",
          "label": "Dòng ghi vào database D1",
          "used": 71200,
          "limit": 100000,
          "percent": 71.2,
          "level": "warning"
        },
        {
          "key": "rowsRead",
          "label": "Dòng đọc từ database D1",
          "used": 950000,
          "limit": 5000000,
          "percent": 19,
          "level": "ok"
        }
      ]
    }
  }
}
```

| Trường              | Ý nghĩa                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `day`               | Ngày đang đếm, theo UTC, dạng `YYYY-MM-DD`.                                                                                                                         |
| `resetAt`           | Lúc Cloudflare đặt lại hạn mức: 00:00 UTC kế tiếp (07:00 giờ Việt Nam), chuỗi ISO.                                                                                  |
| `estimated`         | Luôn `true`: số do hệ thống tự đếm, là ước lượng và thường thấp hơn số thật của Cloudflare (xem README, mục "Hạn mức gói miễn phí và cảnh báo").                    |
| `level`             | Mức cao nhất trong các chỉ số: `ok`, `warning`, `critical`, `paused`. Cũng là `paused` khi D1 đã báo chạm trần ngày dù số đếm chưa tới ngưỡng.                      |
| `metrics`           | Luôn đủ ba phần tử, đúng thứ tự `requests`, `rowsWritten`, `rowsRead`.                                                                                              |
| `metrics[].label`   | Tên tiếng Việt để hiển thị.                                                                                                                                         |
| `metrics[].used`    | Số đã dùng trong ngày (số nguyên). Có thể lớn hơn `limit`.                                                                                                          |
| `metrics[].limit`   | Trần mỗi ngày, lấy từ cấu hình (`USAGE_LIMIT_REQUESTS`, `USAGE_LIMIT_ROWS_WRITTEN`, `USAGE_LIMIT_ROWS_READ`).                                                       |
| `metrics[].percent` | `used / limit * 100`, làm tròn một chữ số thập phân. Có thể trên 100.                                                                                               |
| `metrics[].level`   | `warning` từ 70% của trần, `critical` từ 90%, `paused` từ ngưỡng tạm ngừng (mặc định 97%), còn lại `ok`. Xét trên số chưa làm tròn (69,96% hiển thị `70` vẫn `ok`). |

## GET /api/v1/infrastructure

Mọi số liệu của trang "Quản lý hạ tầng, Cloudflare" trong **một** lời gọi.

- Quyền: chỉ quản trị viên (401 và 403 như trên). Không có tham số. Vẫn phục vụ lúc tạm ngừng.

Trả 200 (các mảng rút gọn):

```json
{
  "status": "success",
  "data": {
    "infrastructure": {
      "plan": "Workers Free",
      "worker": { "name": "app", "url": "https://app.solaris-fbs.workers.dev" },
      "day": "2026-11-21",
      "resetAt": "2026-11-22T00:00:00.000Z",
      "estimated": true,
      "level": "ok",
      "pausePercent": 97,
      "metrics": [
        {
          "key": "requests",
          "label": "Lượt request vào Worker",
          "used": 1234,
          "limit": 100000,
          "percent": 1.2,
          "level": "ok"
        }
      ],
      "hourly": [
        {
          "hour": "2026-11-21T08:00:00.000Z",
          "requests": 120,
          "rowsRead": 1500,
          "rowsWritten": 310,
          "member": 80,
          "guest": 25,
          "anonymous": 15,
          "status404": 6,
          "status429": 0,
          "status5xx": 0,
          "paused": 0
        }
      ],
      "daily": [
        {
          "day": "2026-11-21",
          "requests": 1234,
          "rowsRead": 15200,
          "rowsWritten": 3300,
          "member": 900,
          "guest": 250,
          "anonymous": 84,
          "paused": 0,
          "peakPercent": 3.3
        }
      ],
      "alerts": [
        {
          "day": "2026-11-20",
          "metric": "rowsWritten",
          "label": "Dòng ghi vào database D1",
          "threshold": 70,
          "emailedAt": "2026-11-20T09:14:03.120Z"
        }
      ],
      "protection": [
        {
          "key": "static_assets",
          "label": "File tĩnh và đường dẫn ngoài /api không gọi Worker",
          "active": true,
          "detail": "..."
        }
      ]
    }
  }
}
```

| Trường                              | Ý nghĩa                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`                              | Luôn `"Workers Free"`.                                                                                                                                                                                |
| `worker`                            | `name` là nhãn đầu của tên miền (ví dụ `app`, `app-thu`); `url` là địa chỉ của bản đang chạy.                                                                                                         |
| `day`, `resetAt`, `estimated`       | Như `GET /usage`.                                                                                                                                                                                     |
| `level`, `metrics`                  | Như `GET /usage` (ba chỉ số của hôm nay).                                                                                                                                                             |
| `pausePercent`                      | Ngưỡng tạm ngừng đang cấu hình (mặc định 97).                                                                                                                                                         |
| `hourly`                            | Đúng **48** phần tử, mỗi giờ một phần tử, cũ trước mới sau, phần tử cuối là giờ hiện tại. Giờ không có lưu lượng vẫn có mặt với số 0. `hour` là đầu giờ theo UTC, chuỗi ISO.                          |
| `hourly[].member/guest/anonymous`   | Request chia theo người gọi: `member` có phiên hợp lệ; `guest` là đường của link chia sẻ với token đúng dạng; `anonymous` là còn lại (chưa đăng nhập, đường lạ, dò quét: phần lớn lưu lượng của bot). |
| `hourly[].status404/429/5xx`        | Số request nhận 404, 429, và 5xx. **Không gồm** 503 `quota_paused`: lần từ chối vì tạm ngừng đếm riêng ở `paused`, vì đó không phải lỗi máy chủ.                                                      |
| `hourly[].paused`, `daily[].paused` | Số request bị từ chối vì hệ thống đang tạm ngừng (503 `quota_paused`, và kết nối trực tiếp bị đóng mã 4503). Thêm ngày 21/11/2026; dữ liệu trước đó là 0.                                             |
| `daily`                             | Đúng **30** phần tử, mỗi ngày (UTC) một phần tử, cũ trước mới sau, phần tử cuối là hôm nay. `peakPercent` là mức cao nhất trong ba chỉ số của ngày đó so với trần hiện tại (một chữ số thập phân).    |
| `alerts`                            | Tối đa 20 ngưỡng đã vượt, mới nhất trước. `threshold` là 70, 90 hoặc ngưỡng tạm ngừng. `emailedAt` là `null` khi chưa gửi được email (chưa có khóa, hoặc gửi lỗi và đang chờ thử lại).                |
| `protection`                        | Các lớp bảo vệ hạn mức và trạng thái bật hay chưa: `key` cố định (bảng dưới), `label` và `detail` là chữ tiếng Việt để hiển thị.                                                                      |

`protection[].key` hiện có: `static_assets`, `robots`, `rate_limits`, `anonymous_no_database`, `pause`, `email_alerts`, `warmup`, `waf`. Mục `waf` luôn `active: false` (cần tên miền riêng); frontend nên hiển thị theo `active` chứ không giả định danh sách cố định.

Ghi chú cho frontend:

- Số trong `hourly` và `daily` lệch nhau chút ít là bình thường: số đếm nằm trong bộ nhớ của từng tiến trình khoảng 15 giây rồi mới ghi xuống; lời gọi này cộng thêm phần chưa ghi của riêng tiến trình đang trả lời.
- Tổng `member + guest + anonymous` có thể thấp hơn `requests` một chút: request đang xử lý được đếm vào `requests` ngay lúc vào, còn loại thì chỉ biết lúc trả lời xong.
- Dữ liệu theo giờ giữ 14 ngày, theo ngày và cảnh báo giữ 400 ngày.
- Khi D1 đã hết hạn mức đọc thì chính route này trả 503 `quota_paused` (không đọc được bảng đếm). Khi hết hạn mức request thì Cloudflare chặn trước khi tới Worker.

## Khóa nhúng chung của tổ chức

"Nhúng script một lần, dùng cho mọi dự án": ngoài khóa riêng của từng sản phẩm web (`sdkKey`), mỗi tổ chức có MỘT khóa nhúng chung. Dán đoạn script mang khóa này vào bộ khung website của team thì site nào dựng từ bộ khung đó cũng được nhận, cho mọi sản phẩm web của tổ chức. Đoạn script theo từng sản phẩm vẫn chạy như cũ.

### GET /api/v1/organization/embed

- Quyền: quản trị viên, quản lý, nhân viên. Người chỉ xem: 403 "Bạn không có quyền làm việc này.". Chưa đăng nhập: 401.
- Không có tham số. Tổ chức chưa có khóa thì khóa được sinh ngay ở lần gọi đầu tiên (nhiều lời gọi cùng lúc vẫn nhận cùng một khóa).

Trả 200:

```json
{
  "status": "success",
  "data": {
    "embed": {
      "key": "0123456789abcdef0123456789abcdef",
      "snippet": "<script src=\"https://app.solaris-fbs.workers.dev/bridge.js\" data-key=\"0123456789abcdef0123456789abcdef\" async></script>",
      "rotatedAt": null
    }
  }
}
```

| Trường      | Ý nghĩa                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `key`       | Khóa nhúng chung: 32 ký tự hex thường, cùng dạng với `sdkKey` của sản phẩm.                                                |
| `snippet`   | Đoạn script để dán vào bộ khung website, đã điền sẵn địa chỉ `bridge.js` và khóa. Hiển thị nguyên văn cho người dùng chép. |
| `rotatedAt` | Lần gần nhất quản trị viên đổi khóa (chuỗi ISO), hoặc `null` nếu chưa đổi lần nào.                                         |

### POST /api/v1/organization/embed/rotate

- Quyền: chỉ quản trị viên (vai trò khác 403). Không cần body.
- Sinh khóa mới. **Khóa cũ hết hiệu lực ngay**: mọi site đang nhúng khóa chung phải dán lại đoạn script mới; cho tới lúc đó màn review coi các site ấy như chưa nhúng. Đoạn script theo từng sản phẩm không bị ảnh hưởng. Việc đổi được ghi nhật ký.
- Trả 200, cùng hình dạng với `GET` ở trên, `rotatedAt` là lúc vừa đổi.

### Kiểm khóa của site (hành vi đổi, đường dẫn và hình dạng giữ nguyên)

`POST /api/v1/deliverables/:id/bridge-check` và `POST /api/v1/r/:token/bridge-check`, body `{ "sdkKey": "<32 hex>" }`, trả `{ "status": "success", "data": { "valid": true | false } }` như trước. Khóa gửi lên nay hợp lệ khi trùng **khóa riêng của sản phẩm hoặc khóa nhúng chung của tổ chức**. Frontend không phải đổi gì ở chỗ kiểm: bridge gửi khóa nào thì chuyển khóa đó lên như cũ.

### Sản phẩm web: thêm `bridgeKeyKind`

Object sản phẩm (mọi nơi trả sản phẩm cho team) có thêm một trường đứng sau `bridgeSeenAt`:

| Trường          | Ý nghĩa                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bridgeKeyKind` | Lần gần nhất site được thấy (`bridgeSeenAt`) là qua khóa nào: `"deliverable"` (khóa riêng của sản phẩm), `"organization"` (khóa chung), hoặc `null` khi site chưa từng được thấy. |

Đường của khách (`/api/v1/r/...`) không trả `sdkKey`, khóa chung hay `bridgeKeyKind`: khách chỉ nhận đúng hay sai khi hỏi khóa.
