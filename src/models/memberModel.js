import { sql } from "../db/d1.js";
import { defineModel, json, bool } from "../db/model.js";

const Member = defineModel("members", {
  id: "id",
  org: "org_id",
  email: "email",
  name: "name",
  role: "role",
  // invited: đã cấp quyền, chưa đăng nhập lần nào. suspended: mất quyền ngay ở request kế tiếp.
  status: "status",
  // Danh tính Google gắn cố định từ lần đăng nhập đầu. Không đưa vào bất kỳ dữ liệu trả về nào.
  googleSub: "google_sub",
  skills: json("skills"),
  capacity: "capacity",
  paused: bool("paused"),
  slackUserId: "slack_user_id",
  searchText: "search_text",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

/**
 * Cột phụ `teams` cho câu SELECT trên bảng members (bí danh m): các đơn người đó tham gia, theo thứ tự được thêm,
 * mỗi phần tử là [orderId, làLeader]. Thay cho hai mảng Member.orders và Member.leadOrders của model cũ.
 *
 *   SELECT m.*, ${TEAMS_COLUMN} FROM members m WHERE ...
 */
export const TEAMS_COLUMN = sql.raw(`(
  SELECT json_group_array(json_array(om.order_id, om.leader_position IS NOT NULL) ORDER BY om.created_at, om.order_id)
  FROM order_members om WHERE om.member_id = m.id
) AS teams`);

/**
 * Dòng members (có hoặc không kèm cột teams) thành object cùng hình dạng với document cũ:
 * `orders` là mảng id đơn tham gia, `leadOrders` là mảng id đơn mà người đó được chọn làm leader.
 */
export const toMember = (row) => {
  const member = Member.fromRow(row);
  if (!member) return null;
  const teams = row.teams ? JSON.parse(row.teams) : [];
  member.orders = teams.map(([orderId]) => orderId);
  member.leadOrders = teams
    .filter(([, isLeader]) => isLeader)
    .map(([orderId]) => orderId);
  return member;
};

export default Member;
