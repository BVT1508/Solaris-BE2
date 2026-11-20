import { defineModel, json } from "../db/model.js";

/**
 * Khai báo các bảng còn lại (bảng members ở memberModel.js vì có thêm phần team).
 * Tên thuộc tính giữ như document Mongoose cũ, chỉ khác `_id` thành `id`; cột xem migrations/0001_init.sql.
 * Service viết SQL trực tiếp; các model này lo đổi tên cột, đổi JSON và dựng INSERT, UPDATE.
 *
 * Trường nhạy cảm (Member.googleSub, Deliverable.sdkKey, ShareLink.token, Feedback.authorDeviceHash): model cũ đặt
 * `select: false`. Ở đây fromRow trả mọi cột có trong dòng, nên hàm toPublic của service phải liệt kê từng trường
 * được trả (không spread cả object), và câu SELECT cho danh sách nên bỏ cột không cần.
 */

export const Organization = defineModel("organizations", {
  id: "id",
  name: "name",
  // Khóa nhúng chung cho mọi sản phẩm web của tổ chức (services/organizationService.js). Không trả ra đường của khách.
  embedKey: "embed_key",
  embedKeyRotatedAt: "embed_key_rotated_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const Session = defineModel("sessions", {
  id: "id",
  tokenHash: "token_hash",
  member: "member_id",
  expiresAt: "expires_at",
  userAgent: "user_agent",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const OauthState = defineModel("oauth_states", {
  state: "state",
  codeVerifier: "code_verifier",
  expiresAt: "expires_at",
  createdAt: "created_at",
});

export const Client = defineModel("clients", {
  id: "id",
  org: "org_id",
  name: "name",
  // [{ _id, name, phone, email, isPrimary }]: giữ khóa "_id" vì API cũ trả nguyên mảng này.
  contacts: json("contacts"),
  source: "source",
  tags: json("tags"),
  notes: "notes",
  nameSearch: "name_search",
  searchText: "search_text",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const Order = defineModel("orders", {
  id: "id",
  org: "org_id",
  client: "client_id",
  type: "type",
  title: "title",
  description: "description",
  deadline: "deadline",
  status: "status",
  notes: "notes",
  createdBy: "created_by",
  deliveredAt: "delivered_at",
  reopenedAt: "reopened_at",
  versionsPurgedAt: "versions_purged_at",
  titleSearch: "title_search",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

/** Team của đơn: thay cho Order.members, Order.leaders, Member.orders, Member.leadOrders. */
export const OrderMember = defineModel("order_members", {
  order: "order_id",
  member: "member_id",
  position: "position",
  leaderPosition: "leader_position",
  createdAt: "created_at",
});

export const Deliverable = defineModel("deliverables", {
  id: "id",
  org: "org_id",
  order: "order_id",
  type: "type",
  name: "name",
  url: "url",
  sdkKey: "sdk_key",
  // [{ id, provider, key, contentType, bytes, width, height, pages, originalName, replaces, removedAt, createdAt }]
  files: json("files"),
  status: "status",
  archivedAt: "archived_at",
  createdBy: "created_by",
  bridgeSeenAt: "bridge_seen_at",
  // Lần gần nhất site được thấy là qua khóa nào: "deliverable" (khóa riêng) hay "organization" (khóa chung).
  bridgeKeyKind: "bridge_key_kind",
  feedbackSeq: "feedback_seq",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const ShareLink = defineModel("share_links", {
  id: "id",
  org: "org_id",
  order: "order_id",
  deliverable: "deliverable_id",
  token: "token",
  contactName: "contact_name",
  contactId: "contact_id",
  note: "note",
  status: "status",
  revokedAt: "revoked_at",
  lastOpenedAt: "last_opened_at",
  openCount: "open_count",
  createdBy: "created_by",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const Round = defineModel("rounds", {
  id: "id",
  org: "org_id",
  order: "order_id",
  deliverable: "deliverable_id",
  number: "number",
  status: "status",
  openedBy: "opened_by",
  openedAt: "opened_at",
  // Mảng id file khách được xem trong vòng này, theo thứ tự.
  files: json("files"),
  url: "url",
  note: "note",
  submittedAt: "submitted_at",
  submittedByLink: "submitted_by_link",
  approvedAt: "approved_at",
  approvedByLink: "approved_by_link",
  // [{ id, pageUrl, shot: { provider, key, contentType, bytes, width, height }, docSize, pins: [{ feedback, x, y }], capturedAt, late }]
  pages: json("pages"),
  pagesRev: "pages_rev",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const Feedback = defineModel("feedback", {
  id: "id",
  org: "org_id",
  order: "order_id",
  deliverable: "deliverable_id",
  round: "round_id",
  roundNumber: "round_number",
  shareLink: "share_link_id",
  seq: "seq",
  clientId: "client_id",
  // author của model cũ trải thành bốn cột.
  authorKind: "author_kind",
  authorName: "author_name",
  authorMember: "author_member_id",
  authorDeviceHash: "author_device_hash",
  visibility: "visibility",
  body: "body",
  // target của model cũ trải thành hai cột.
  targetFileId: "target_file_id",
  targetPage: "target_page",
  mark: json("mark"),
  anchor: json("anchor"),
  screenshot: json("screenshot"),
  status: "status",
  assignee: "assignee_id",
  // [{ id, authorKind, authorName, authorMember, deviceHash, visibility, body, createdAt }]
  replies: json("replies"),
  submittedAt: "submitted_at",
  resolvedAt: "resolved_at",
  resolvedBy: "resolved_by",
  confirmedAt: "confirmed_at",
  reopenedCount: "reopened_count",
  reopenedRoundNumber: "reopened_round_number",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const AuditLog = defineModel("audit_logs", {
  id: "id",
  org: "org_id",
  actorKind: "actor_kind",
  actorMember: "actor_member_id",
  actorLabel: "actor_label",
  action: "action",
  entityType: "entity_type",
  entityId: "entity_id",
  order: "order_id",
  deliverable: "deliverable_id",
  before: json("before"),
  after: json("after"),
  at: "at",
});
