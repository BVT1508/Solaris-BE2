import env from "../config/env.js";
import {
  all,
  first,
  guard,
  sql,
  transact,
  uniqueViolationOf,
} from "../db/d1.js";
import Member, { TEAMS_COLUMN, toMember } from "../models/memberModel.js";
import { assertCan } from "../policies/policy.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { newId } from "../utils/id.js";
import { disconnectMember } from "../utils/realtime.js";
import { matches, toSearchText } from "../utils/searchText.js";
import { now } from "../utils/time.js";
import { destroyAllSessionsStatement } from "./authService.js";
import { unassignOpenWorkStatement } from "./unassignService.js";

const EMAIL_TAKEN = () => new AppError("Email này đã có trong hệ thống.", 409);
const LAST_ADMIN = () =>
  new AppError("Phải còn ít nhất một quản trị viên đang hoạt động.", 409);

const toPublic = (member) => ({
  id: member.id,
  email: member.email,
  name: member.name,
  role: member.role,
  status: member.status,
  isOwner: member.email === env.OWNER_EMAIL,
  orders: member.orders || [],
  skills: member.skills || [],
  capacity: member.capacity,
  paused: member.paused,
  slackUserId: member.slackUserId || null,
  version: member.version,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
});

async function findTarget(actor, id) {
  const member = toMember(
    await first(sql`
      SELECT m.*, ${TEAMS_COLUMN} FROM members m
      WHERE m.id = ${id} AND m.org_id = ${actor.orgId}`)
  );
  if (!member) throw new AppError("Không tìm thấy thành viên.", 404);
  return member;
}

/** Luật bảo vệ: chủ hệ thống bất khả xâm phạm, không ai tự hạ quyền hay tự khóa. */
function assertProtectedRules(actor, target, { roleChanged, suspending }) {
  if (target.email === env.OWNER_EMAIL && (roleChanged || suspending)) {
    throw new AppError("Không thể đổi quyền của chủ hệ thống.", 403);
  }
  if (target.id === actor.memberId && (roleChanged || suspending)) {
    throw new AppError("Bạn không thể tự hạ quyền hoặc tự tạm khóa.", 403);
  }
}

/** Còn quản trị viên đang hoạt động nào khác ngoài người này không. Dùng cả để kiểm trước lẫn làm guard trong lô. */
const anotherActiveAdmin = (orgId, exceptId) => sql`
  SELECT 1 FROM members
  WHERE org_id = ${orgId} AND role = 'admin' AND status = 'active' AND id <> ${exceptId}`;

/** Không bao giờ để hệ thống không còn quản trị viên đang hoạt động. */
async function assertAnotherActiveAdmin(orgId, exceptId) {
  if (!(await first(anotherActiveAdmin(orgId, exceptId)))) throw LAST_ADMIN();
}

const versionGuard = (id, version) =>
  guard(
    sql`SELECT 1 FROM members WHERE id = ${id} AND version = ${version}`,
    "stale"
  );

const GUARD_ERRORS = { stale: STALE, lastAdmin: LAST_ADMIN };

// ---------- Đọc ----------

export async function listMembers(actor, query = {}) {
  assertCan(actor, "member.manage");
  const where = [sql`m.org_id = ${actor.orgId}`];
  if (query.role) where.push(sql`m.role = ${query.role}`);
  if (query.status) where.push(sql`m.status = ${query.status}`);
  if (query.search) {
    where.push(matches(sql.raw("m.search_text"), query.search));
  }
  const rows = await all(sql`
    SELECT m.*, ${TEAMS_COLUMN} FROM members m
    WHERE ${sql.and(where)} ORDER BY m.name, m.id`);
  return rows.map(toMember).map(toPublic);
}

export async function getMember(actor, id) {
  assertCan(actor, "member.manage");
  return toPublic(await findTarget(actor, id));
}

// ---------- Ghi ----------

/** Cấp quyền: tài khoản ở trạng thái "đã mời" tới lần đăng nhập đầu. Không gửi email. */
export async function createMember(actor, input) {
  assertCan(actor, "member.manage");
  const exists = await first(
    sql`SELECT 1 FROM members WHERE email = ${input.email}`
  );
  if (exists) throw EMAIL_TAKEN();

  const at = now();
  const member = {
    id: newId(),
    org: actor.orgId,
    email: input.email,
    name: input.name,
    role: input.role,
    status: "invited",
    skills: input.skills,
    capacity: input.capacity ?? 8,
    paused: false,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  try {
    await transact(async () => ({
      statements: [
        Member.insert({
          ...member,
          searchText: toSearchText(member.name, member.email),
        }),
        auditStatement({
          actor,
          action: "member.create",
          entityType: "member",
          entityId: member.id,
          after: {
            email: member.email,
            role: member.role,
            skills: member.skills,
          },
        }),
      ],
    }));
  } catch (err) {
    // Hai người cấp quyền cho cùng một email gần như cùng lúc: chỉ mục duy nhất chặn người sau.
    if (uniqueViolationOf(err)) throw EMAIL_TAKEN();
    throw err;
  }
  return toPublic(member);
}

/**
 * Sửa tên, vai trò, kỹ năng, sức chứa, tạm nghỉ.
 * Lên admin thì rời mọi team (admin thấy hết): xóa các dòng order_members của người đó.
 * Xuống người chỉ xem thì thôi làm leader ở mọi đơn (người chỉ xem không được làm leader).
 * Hạ admin xuống: gán lại từ phía đơn hàng; việc dang dở ở các đơn không còn quyền thì bỏ giao.
 */
export async function updateMember(actor, id, input) {
  assertCan(actor, "member.manage");
  let roleChangedTo = null;
  const result = await transact(
    async () => {
      const target = await findTarget(actor, id);
      if (target.version !== input.version) throw STALE();

      const nextRole = input.role ?? target.role;
      const roleChanged = nextRole !== target.role;
      assertProtectedRules(actor, target, { roleChanged, suspending: false });

      const demotingActiveAdmin =
        target.role === "admin" &&
        nextRole !== "admin" &&
        target.status === "active";
      if (demotingActiveAdmin) {
        await assertAnotherActiveAdmin(actor.orgId, target.id);
      }

      const { version, ...fields } = input;
      const at = now();
      const leavingTeams = nextRole === "admin" && roleChanged;
      const leavingLead = roleChanged && nextRole === "viewer";
      const name = fields.name ?? target.name;

      const statements = [versionGuard(target.id, version)];
      if (demotingActiveAdmin) {
        statements.push(
          guard(anotherActiveAdmin(actor.orgId, target.id), "lastAdmin")
        );
      }
      statements.push(sql`
        UPDATE members SET ${Member.set({
          ...fields,
          searchText: toSearchText(name, target.email),
          updatedAt: at,
        })}, version = version + 1
        WHERE id = ${target.id}`);
      if (leavingTeams) {
        // Bảng order_members là nguồn duy nhất của team: xóa ở đây là rời team và thôi leader ở mọi đơn.
        statements.push(
          sql`DELETE FROM order_members WHERE member_id = ${target.id}`
        );
      }
      if (leavingLead) {
        statements.push(sql`
          UPDATE order_members SET leader_position = NULL WHERE member_id = ${target.id}`);
      }
      if (roleChanged && target.role === "admin" && nextRole !== "admin") {
        // Admin nhận việc ở mọi đơn. Hạ xuống thì chỉ còn quyền ở đơn mình được gán (lúc này chưa có đơn nào):
        // bỏ giao việc dang dở ở các đơn còn lại để chúng về hàng "chưa giao".
        statements.push(
          unassignOpenWorkStatement({
            memberIds: [target.id],
            exceptOrderIds: target.orders,
          })
        );
      }
      if (roleChanged && nextRole === "viewer") {
        // Người chỉ xem không xử lý được góp ý: bỏ giao hết.
        statements.push(unassignOpenWorkStatement({ memberIds: [target.id] }));
      }
      statements.push(
        auditStatement({
          actor,
          action: "member.update",
          entityType: "member",
          entityId: target.id,
          before: pick(target, Object.keys(fields)),
          after: fields,
        })
      );

      return {
        statements,
        done: () => {
          roleChangedTo = roleChanged ? nextRole : null;
          return toPublic({
            ...target,
            ...fields,
            orders: leavingTeams ? [] : target.orders,
            version: target.version + 1,
            updatedAt: at,
          });
        },
      };
    },
    { errors: GUARD_ERRORS }
  );
  // Vai trò đổi thì quyền nghe trực tiếp cũng đổi: ngắt, trình duyệt nối lại sẽ được kiểm theo vai trò mới.
  if (roleChangedTo) disconnectMember(id);
  return result;
}

/** Tạm khóa: mất quyền ngay request kế tiếp vì mọi phiên bị hủy trong cùng lô. */
export async function suspendMember(actor, id, input) {
  assertCan(actor, "member.manage");
  const suspended = await transact(
    async () => {
      const target = await findTarget(actor, id);
      if (target.version !== input.version) throw STALE();
      if (target.status === "suspended") {
        throw new AppError("Tài khoản đã bị tạm khóa rồi.", 409);
      }
      assertProtectedRules(actor, target, {
        roleChanged: false,
        suspending: true,
      });
      const activeAdmin = target.role === "admin" && target.status === "active";
      if (activeAdmin) await assertAnotherActiveAdmin(actor.orgId, target.id);

      const at = now();
      return {
        statements: [
          versionGuard(target.id, input.version),
          ...(activeAdmin
            ? [guard(anotherActiveAdmin(actor.orgId, target.id), "lastAdmin")]
            : []),
          sql`UPDATE members SET status = 'suspended', version = version + 1, updated_at = ${at}
              WHERE id = ${target.id}`,
          destroyAllSessionsStatement(target.id),
          // Người bị khóa không làm tiếp được: bỏ giao mọi góp ý còn dang dở của họ.
          unassignOpenWorkStatement({ memberIds: [target.id] }),
          auditStatement({
            actor,
            action: "member.suspend",
            entityType: "member",
            entityId: target.id,
            before: { status: target.status },
            after: { status: "suspended" },
          }),
        ],
        done: () =>
          toPublic({
            ...target,
            status: "suspended",
            version: target.version + 1,
            updatedAt: at,
          }),
      };
    },
    { errors: GUARD_ERRORS }
  );
  // Phiên đã bị hủy trong lô; kết nối trực tiếp đang mở thì ngắt luôn.
  disconnectMember(id);
  return suspended;
}

/** Mở khóa: đã từng đăng nhập Google thì về "active", chưa thì về "invited". */
export async function activateMember(actor, id, input) {
  assertCan(actor, "member.manage");
  return transact(
    async () => {
      const target = await findTarget(actor, id);
      if (target.version !== input.version) throw STALE();
      if (target.status !== "suspended") {
        throw new AppError("Tài khoản không bị tạm khóa.", 409);
      }
      const status = target.googleSub ? "active" : "invited";
      const at = now();
      return {
        statements: [
          versionGuard(target.id, input.version),
          sql`UPDATE members SET status = ${status}, version = version + 1, updated_at = ${at}
              WHERE id = ${target.id}`,
          auditStatement({
            actor,
            action: "member.activate",
            entityType: "member",
            entityId: target.id,
            before: { status: "suspended" },
            after: { status },
          }),
        ],
        done: () =>
          toPublic({
            ...target,
            status,
            version: target.version + 1,
            updatedAt: at,
          }),
      };
    },
    { errors: GUARD_ERRORS }
  );
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}
