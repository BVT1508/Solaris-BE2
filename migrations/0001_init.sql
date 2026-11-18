-- Lược đồ D1 của Solaris. Đối chiếu từng bảng với model Mongoose cũ: docs/kien-truc.md mục 2.
--
-- Quy ước chung:
--   id          TEXT 24 ký tự hex chữ thường (như ObjectId), sinh ở src/utils/id.js, sắp theo thời gian tạo.
--   thời gian   TEXT ISO-8601 UTC có mili giây ("2026-11-18T14:03:22.123Z"): so sánh chuỗi là so sánh thời gian.
--   boolean     INTEGER 0 hoặc 1.
--   JSON        TEXT; chỉ dùng cho phần luôn đọc và ghi cùng bản ghi cha.
--   version     khóa lạc quan, tăng 1 mỗi lần sửa.

-- ---------- Tổ chức, thành viên, phiên ----------

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff', 'viewer')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  -- Danh tính Google gắn cố định từ lần đăng nhập đầu. Không bao giờ trả ra API.
  google_sub TEXT,
  -- JSON: [{ "skill": "design", "level": "primary" }]
  skills TEXT NOT NULL DEFAULT '[]',
  capacity INTEGER NOT NULL DEFAULT 8,
  paused INTEGER NOT NULL DEFAULT 0,
  slack_user_id TEXT,
  -- Tên và email đã bỏ dấu, chữ thường: cho ô tìm (src/utils/searchText.js).
  search_text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX members_email ON members (email);
CREATE UNIQUE INDEX members_google_sub ON members (google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX members_org_name ON members (org_id, name);

-- Phiên đăng nhập: cookie giữ token ngẫu nhiên, bảng chỉ giữ băm SHA-256. Dòng hết hạn do cron dọn.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members (id),
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX sessions_token_hash ON sessions (token_hash);
CREATE INDEX sessions_member ON sessions (member_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Một lần đăng nhập Google đang chờ (state chống giả mạo callback, code_verifier cho PKCE). Sống 10 phút.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX oauth_states_expires ON oauth_states (expires_at);

-- ---------- Khách hàng, đơn hàng ----------

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  -- JSON: [{ "_id": "<24 hex>", "name", "phone", "email", "isPrimary" }]. Giữ khóa "_id" vì API cũ trả nguyên như vậy.
  contacts TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'outreach' CHECK (source IN ('outreach', 'referral', 'returning', 'inbound', 'other')),
  -- JSON: ["vip", "f&b"]
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  -- Tên đã bỏ dấu (tìm đơn theo tên khách), và tên + mọi người liên hệ đã bỏ dấu (ô tìm khách).
  name_search TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX clients_org ON clients (org_id, id);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  client_id TEXT NOT NULL REFERENCES clients (id),
  type TEXT NOT NULL CHECK (type IN ('web', 'print', 'video', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'in_progress', 'awaiting_feedback', 'revising', 'approved', 'delivered')),
  -- Ghi chú nội bộ, khách không bao giờ thấy.
  notes TEXT,
  created_by TEXT,
  delivered_at TEXT,
  reopened_at TEXT,
  versions_purged_at TEXT,
  title_search TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX orders_org_status ON orders (org_id, status, id);
CREATE INDEX orders_org_type ON orders (org_id, type, id);
CREATE INDEX orders_client ON orders (client_id, id);
-- Cron dọn bản cũ tìm đơn đã bàn giao quá hạn.
CREATE INDEX orders_delivered ON orders (status, delivered_at);

-- Team của đơn. Thay cho CẢ BỐN mảng cũ: Order.members, Order.leaders, Member.orders, Member.leadOrders
-- (không còn bản phản chiếu phải giữ đồng bộ). Quản trị viên không bao giờ có dòng ở đây.
CREATE TABLE order_members (
  order_id TEXT NOT NULL REFERENCES orders (id),
  member_id TEXT NOT NULL REFERENCES members (id),
  -- Thứ tự trong Order.members cũ (thứ tự người dùng chọn).
  position INTEGER NOT NULL DEFAULT 0,
  -- NULL: không phải leader được chọn của đơn. Có số: là leader, số là thứ tự trong Order.leaders cũ.
  leader_position INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (order_id, member_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX order_members_member ON order_members (member_id, created_at);

-- ---------- Sản phẩm bàn giao, link chia sẻ, vòng review ----------

CREATE TABLE deliverables (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  order_id TEXT NOT NULL REFERENCES orders (id),
  type TEXT NOT NULL CHECK (type IN ('web', 'design', 'document')),
  name TEXT NOT NULL,
  url TEXT,
  -- Chỉ web. Chỉ quản trị viên và leader của đơn được thấy.
  sdk_key TEXT,
  -- JSON: [{ "id", "provider", "key", "contentType", "bytes", "width", "height", "pages", "originalName",
  --          "replaces", "removedAt", "createdAt" }], theo đúng thứ tự hiển thị.
  files TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at TEXT,
  created_by TEXT,
  bridge_seen_at TEXT,
  -- Bộ đếm số thứ tự góp ý của sản phẩm; chỉ tăng, không cấp lại.
  feedback_seq INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX deliverables_sdk_key ON deliverables (sdk_key) WHERE sdk_key IS NOT NULL;
CREATE INDEX deliverables_order ON deliverables (order_id, status, id);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  order_id TEXT NOT NULL REFERENCES orders (id),
  deliverable_id TEXT NOT NULL REFERENCES deliverables (id),
  -- Lưu nguyên token (không băm) vì team cần chép lại link. Chỉ quản trị viên và leader của đơn được thấy.
  token TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  revoked_at TEXT,
  last_opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX share_links_token ON share_links (token);
CREATE INDEX share_links_deliverable ON share_links (deliverable_id, status, id);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  order_id TEXT NOT NULL REFERENCES orders (id),
  deliverable_id TEXT NOT NULL REFERENCES deliverables (id),
  number INTEGER NOT NULL CHECK (number >= 1),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'approved')),
  opened_by TEXT,
  opened_at TEXT NOT NULL,
  -- JSON: mảng id file (theo thứ tự) mà khách được xem trong vòng này. Dữ liệu mới luôn có, nên không còn nhánh "vòng cũ".
  files TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  note TEXT,
  submitted_at TEXT,
  submitted_by_link TEXT,
  approved_at TEXT,
  approved_by_link TEXT,
  -- JSON: [{ "id", "pageUrl", "shot": { "provider", "key", "contentType", "bytes", "width", "height" },
  --          "docSize": { "w", "h" }, "pins": [{ "feedback", "x", "y" }], "capturedAt", "late" }]
  pages TEXT NOT NULL DEFAULT '[]',
  -- Tăng mỗi lần lưu bộ ảnh trang: hai người lưu cùng lúc thì người sau bị từ chối.
  pages_rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Mỗi sản phẩm không có hai vòng cùng số: chặn hai người bấm mở vòng cùng lúc.
CREATE UNIQUE INDEX rounds_deliverable_number ON rounds (deliverable_id, number);
CREATE INDEX rounds_order ON rounds (order_id);

-- ---------- Góp ý ----------

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  order_id TEXT NOT NULL REFERENCES orders (id),
  deliverable_id TEXT NOT NULL REFERENCES deliverables (id),
  round_id TEXT NOT NULL REFERENCES rounds (id),
  round_number INTEGER NOT NULL,
  share_link_id TEXT,
  seq INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('member', 'guest', 'system')),
  author_name TEXT NOT NULL,
  author_member_id TEXT,
  -- Băm của mã thiết bị khách. Không API nào trả cột này.
  author_device_hash TEXT,
  visibility TEXT NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer', 'team')),
  body TEXT NOT NULL,
  -- target của model cũ: cả hai NULL là nhận xét chung.
  target_file_id TEXT,
  target_page INTEGER,
  -- JSON đúng như đã qua validator: mark { kind, x, y, w, h, points }, anchor { pageUrl, selector, ... },
  -- screenshot { provider, key, contentType, bytes, width, height, rect }.
  mark TEXT,
  anchor TEXT,
  screenshot TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'in_progress', 'done', 'confirmed')),
  assignee_id TEXT,
  -- JSON: [{ "id", "authorKind", "authorName", "authorMemberId", "deviceHash", "visibility", "body", "createdAt" }]
  -- Thêm trả lời bằng json_insert(replies, '$[#]', json(?)) để không phải đọc rồi ghi.
  replies TEXT NOT NULL DEFAULT '[]',
  submitted_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  confirmed_at TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  reopened_round_number INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX feedback_deliverable_seq ON feedback (deliverable_id, seq);
-- Idempotent theo clientId: gửi lại cùng mã thì trả bài cũ.
CREATE UNIQUE INDEX feedback_deliverable_client ON feedback (deliverable_id, client_id);
CREATE INDEX feedback_deliverable_status ON feedback (deliverable_id, status, seq);
CREATE INDEX feedback_round_link ON feedback (round_id, share_link_id);
CREATE INDEX feedback_order_status ON feedback (order_id, status);
CREATE INDEX feedback_assignee_status ON feedback (assignee_id, status);
-- File còn góp ý ghim lên thì phải giữ (isRetained).
CREATE INDEX feedback_target_file ON feedback (deliverable_id, target_file_id) WHERE target_file_id IS NOT NULL;

-- ---------- Nhật ký ----------

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('member', 'guest', 'system')),
  actor_member_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  order_id TEXT,
  deliverable_id TEXT,
  -- JSON tùy hành động (before, after của model cũ).
  before TEXT,
  after TEXT,
  at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id, at);
-- Màn "Hoạt động" của đơn: mới nhất trước, phân trang theo id.
CREATE INDEX audit_logs_order ON audit_logs (order_id, id) WHERE order_id IS NOT NULL;

-- ---------- Hạ tầng (không có trong MongoDB cũ) ----------

-- Bộ đếm cho hạn mức cần chính xác theo khóa nghiệp vụ (ví dụ số lần xin chỗ đẩy ảnh của một link trong 10 phút).
-- Hạn mức theo IP dùng Rate Limiting binding, không ghi vào đây.
CREATE TABLE rate_counters (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
) STRICT, WITHOUT ROWID;

-- File trên kho chờ xóa. Ghi trong cùng batch với thay đổi làm file thành thừa; xóa thật chạy sau response và trong cron.
CREATE TABLE storage_trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  key TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- Điều kiện bảo vệ trong batch (thay cho giao dịch đọc rồi ghi của MongoDB): xem src/db/d1.js, hàm guard().
-- Mỗi guard là một câu INSERT vào bảng này với ok = 1 (điều kiện đúng) hoặc 0 (sai).
-- ok = 0: trigger ném lỗi, D1 hoàn tác CẢ batch. ok = 1: trigger bỏ qua dòng, không ghi gì. Bảng luôn trống.
CREATE TABLE tx_guard (
  ok INTEGER NOT NULL,
  label TEXT
) STRICT;

CREATE TRIGGER tx_guard_check
BEFORE INSERT ON tx_guard
BEGIN
  SELECT CASE WHEN NEW.ok = 0 THEN RAISE (ABORT, 'TX_GUARD:' || COALESCE(NEW.label, '')) END;
  SELECT RAISE (IGNORE);
END;
