-- Số đếm mức dùng theo GIỜ và theo loại lưu lượng, cho trang "Quản lý hạ tầng" (GET /api/v1/infrastructure).
-- Xem src/services/usageService.js. Như bảng usage_daily: số ước lượng do Worker tự đếm.

-- Mỗi giờ UTC một dòng. Mỗi lần ghi số đếm cộng vào đúng một dòng: dòng của giờ hiện tại.
-- Việc định kỳ xóa dòng cũ hơn 14 ngày.
CREATE TABLE usage_hourly (
  hour TEXT NOT NULL PRIMARY KEY, -- 'YYYY-MM-DDTHH' theo UTC
  requests INTEGER NOT NULL DEFAULT 0,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  -- Request chia theo người gọi: thành viên có phiên hợp lệ, khách của link chia sẻ, còn lại (nhiều khả năng là bot).
  member INTEGER NOT NULL DEFAULT 0,
  guest INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,
  -- Request chia theo mã trả về đáng chú ý.
  status_404 INTEGER NOT NULL DEFAULT 0,
  status_429 INTEGER NOT NULL DEFAULT 0,
  status_5xx INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- Bảng theo ngày thêm phần chia theo người gọi (giữ 400 ngày).
ALTER TABLE usage_daily ADD COLUMN member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0;
