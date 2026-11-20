-- Mức dùng gói miễn phí của Cloudflare, đếm theo ngày UTC, để báo sớm cho quản trị viên trước khi chạm trần.
-- Xem src/services/usageService.js. Đây là số ƯỚC LƯỢNG do chính Worker tự đếm, không phải số của Cloudflare.

-- Mỗi ngày UTC một dòng. Worker cộng dồn trong bộ nhớ rồi ghi xuống theo lô (một câu UPSERT cho nhiều request).
CREATE TABLE usage_daily (
  day TEXT NOT NULL PRIMARY KEY, -- 'YYYY-MM-DD' theo UTC
  requests INTEGER NOT NULL DEFAULT 0, -- request vào Worker (không tính file tĩnh do Cloudflare tự phục vụ)
  rows_read INTEGER NOT NULL DEFAULT 0, -- dòng D1 đã đọc (meta.rows_read của từng câu)
  rows_written INTEGER NOT NULL DEFAULT 0, -- dòng D1 đã ghi (meta.rows_written của từng câu)
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- Ngưỡng đã vượt trong ngày: mỗi chỉ số, mỗi ngưỡng (70, 90), mỗi ngày đúng một dòng, nên email không gửi trùng.
-- emailed_at trống: chưa gửi được (chưa có khóa của dịch vụ email, hoặc lần gửi trước lỗi) và sẽ thử lại ở lượt kiểm sau.
CREATE TABLE usage_alerts (
  day TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('requests', 'rowsWritten', 'rowsRead')),
  threshold INTEGER NOT NULL,
  used INTEGER NOT NULL,
  limit_value INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  emailed_at TEXT,
  email_error TEXT,
  PRIMARY KEY (day, metric, threshold)
) STRICT, WITHOUT ROWID;
