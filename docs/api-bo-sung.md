# API bổ sung của bản Cloudflare

Hợp đồng API gốc nằm ở `Solaris BE/docs/api-gop-y.md` và giữ nguyên. File này ghi các đường **chỉ bản Cloudflare có**. Quy ước chung (cookie phiên, phong bì `{ status, data }`, lỗi `{ status: "fail", message }`, header `Cache-Control: no-store`) như mọi route khác.

## GET /api/v1/usage

Mức dùng gói miễn phí của Cloudflare trong ngày hiện tại (ngày tính theo UTC), cho màn quản trị.

- Quyền: chỉ quản trị viên. Chưa đăng nhập: 401 "Bạn chưa đăng nhập hoặc phiên đã hết hạn.". Vai trò khác: 403 "Bạn không có quyền làm việc này.".
- Không có tham số.

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

| Trường              | Ý nghĩa                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `day`               | Ngày đang đếm, theo UTC, dạng `YYYY-MM-DD`.                                                                                                      |
| `resetAt`           | Lúc Cloudflare đặt lại hạn mức: 00:00 UTC kế tiếp (07:00 giờ Việt Nam), chuỗi ISO.                                                               |
| `estimated`         | Luôn `true`: số do hệ thống tự đếm, là ước lượng và thường thấp hơn số thật của Cloudflare (xem README, mục "Hạn mức gói miễn phí và cảnh báo"). |
| `level`             | Mức cao nhất trong các chỉ số: `ok`, `warning`, `critical`.                                                                                      |
| `metrics`           | Luôn đủ ba phần tử, đúng thứ tự `requests`, `rowsWritten`, `rowsRead`.                                                                           |
| `metrics[].label`   | Tên tiếng Việt để hiển thị.                                                                                                                      |
| `metrics[].used`    | Số đã dùng trong ngày (số nguyên). Có thể lớn hơn `limit`.                                                                                       |
| `metrics[].limit`   | Trần mỗi ngày, lấy từ cấu hình (`USAGE_LIMIT_REQUESTS`, `USAGE_LIMIT_ROWS_WRITTEN`, `USAGE_LIMIT_ROWS_READ`).                                    |
| `metrics[].percent` | `used / limit * 100`, làm tròn một chữ số thập phân. Có thể trên 100.                                                                            |
| `metrics[].level`   | `warning` khi đã dùng từ 70% của trần, `critical` khi từ 90%, còn lại `ok`. Xét trên số chưa làm tròn (69,96% hiển thị `70` nhưng vẫn `ok`).     |

Ghi chú cho frontend:

- Số thay đổi liên tục; gọi lại khi mở màn hoặc theo nhịp vài chục giây, không cần kết nối trực tiếp.
- Khi D1 đã hết hạn mức đọc trong ngày thì chính route này cũng lỗi 500 (không đọc được bảng đếm). Khi hết hạn mức request thì Cloudflare chặn trước khi tới Worker (trang lỗi 1027).
