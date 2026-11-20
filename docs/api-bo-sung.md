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
- Một tiến trình mới của Worker chưa biết số đếm nên chưa chặn ngay; nó bắt đầu chặn sau lần ghi số đếm đầu tiên (khoảng 15 giây) hoặc khi D1 báo lỗi chạm trần. Vì vậy ngay sau lúc tạm ngừng vẫn có thể có vài request lọt qua.

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
          "status5xx": 0
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

| Trường                            | Ý nghĩa                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`                            | Luôn `"Workers Free"`.                                                                                                                                                                                |
| `worker`                          | `name` là nhãn đầu của tên miền (ví dụ `app`, `app-thu`); `url` là địa chỉ của bản đang chạy.                                                                                                         |
| `day`, `resetAt`, `estimated`     | Như `GET /usage`.                                                                                                                                                                                     |
| `level`, `metrics`                | Như `GET /usage` (ba chỉ số của hôm nay).                                                                                                                                                             |
| `pausePercent`                    | Ngưỡng tạm ngừng đang cấu hình (mặc định 97).                                                                                                                                                         |
| `hourly`                          | Đúng **48** phần tử, mỗi giờ một phần tử, cũ trước mới sau, phần tử cuối là giờ hiện tại. Giờ không có lưu lượng vẫn có mặt với số 0. `hour` là đầu giờ theo UTC, chuỗi ISO.                          |
| `hourly[].member/guest/anonymous` | Request chia theo người gọi: `member` có phiên hợp lệ; `guest` là đường của link chia sẻ với token đúng dạng; `anonymous` là còn lại (chưa đăng nhập, đường lạ, dò quét: phần lớn lưu lượng của bot). |
| `hourly[].status404/429/5xx`      | Số request nhận 404, 429, và 5xx (gồm cả 503 `quota_paused` lúc tạm ngừng).                                                                                                                           |
| `daily`                           | Đúng **30** phần tử, mỗi ngày (UTC) một phần tử, cũ trước mới sau, phần tử cuối là hôm nay. `peakPercent` là mức cao nhất trong ba chỉ số của ngày đó so với trần hiện tại (một chữ số thập phân).    |
| `alerts`                          | Tối đa 20 ngưỡng đã vượt, mới nhất trước. `threshold` là 70, 90 hoặc ngưỡng tạm ngừng. `emailedAt` là `null` khi chưa gửi được email (chưa có khóa, hoặc gửi lỗi và đang chờ thử lại).                |
| `protection`                      | Các lớp bảo vệ hạn mức và trạng thái bật hay chưa: `key` cố định (bảng dưới), `label` và `detail` là chữ tiếng Việt để hiển thị.                                                                      |

`protection[].key` hiện có: `static_assets`, `robots`, `rate_limits`, `anonymous_no_database`, `pause`, `email_alerts`, `warmup`, `waf`. Mục `waf` luôn `active: false` (cần tên miền riêng); frontend nên hiển thị theo `active` chứ không giả định danh sách cố định.

Ghi chú cho frontend:

- Số trong `hourly` và `daily` lệch nhau chút ít là bình thường: số đếm nằm trong bộ nhớ của từng tiến trình khoảng 15 giây rồi mới ghi xuống; lời gọi này cộng thêm phần chưa ghi của riêng tiến trình đang trả lời.
- Tổng `member + guest + anonymous` có thể thấp hơn `requests` một chút: request đang xử lý được đếm vào `requests` ngay lúc vào, còn loại thì chỉ biết lúc trả lời xong.
- Dữ liệu theo giờ giữ 14 ngày, theo ngày và cảnh báo giữ 400 ngày.
- Khi D1 đã hết hạn mức đọc thì chính route này trả 503 `quota_paused` (không đọc được bảng đếm). Khi hết hạn mức request thì Cloudflare chặn trước khi tới Worker.
