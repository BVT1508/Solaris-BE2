-- Khóa nhúng chung của tổ chức: dán một đoạn script vào bộ khung website của team là dùng được cho MỌI sản phẩm web,
-- không phải chép đoạn script riêng của từng sản phẩm. Xem src/services/organizationService.js.

-- 32 ký tự hex như sdk_key của sản phẩm. NULL cho tới lần đầu có người xem trang khóa nhúng (sinh lúc đó).
ALTER TABLE organizations ADD COLUMN embed_key TEXT;
-- Lần gần nhất quản trị viên đổi khóa chung; NULL nếu chưa đổi lần nào.
ALTER TABLE organizations ADD COLUMN embed_key_rotated_at TEXT;

-- Lần gần nhất site của sản phẩm được thấy là qua khóa nào: 'deliverable' (khóa riêng của sản phẩm) hay
-- 'organization' (khóa chung). Ghi cùng lúc với bridge_seen_at.
ALTER TABLE deliverables ADD COLUMN bridge_key_kind TEXT CHECK (bridge_key_kind IN ('deliverable', 'organization'));
