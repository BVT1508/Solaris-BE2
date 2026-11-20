-- Số request bị từ chối vì hệ thống đang tạm ngừng (503 "quota_paused"), đếm RIÊNG khỏi cột status_5xx:
-- đó là hệ thống chủ động từ chối khi sắp hết hạn mức, không phải lỗi máy chủ. Xem src/services/usageService.js.
ALTER TABLE usage_hourly ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
