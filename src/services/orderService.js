import { all, first, guard, guardNot, sql, transact } from "../db/d1.js";
import { Client, Order } from "../models/index.js";
import { assertCan } from "../policies/policy.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { newId } from "../utils/id.js";
import { beforeCursor, pageOf } from "../utils/pagination.js";
import { disconnectMember } from "../utils/realtime.js";
import { matches, toSearchText } from "../utils/searchText.js";
import { now, toIso } from "../utils/time.js";
import { clientSearchColumns } from "./clientService.js";
import {
  isManualStatus,
  syncOrderStatusStatement,
} from "./orderStatusService.js";
import { unassignOpenWorkStatement } from "./unassignService.js";

/**
 * Cột phụ cho câu SELECT trên bảng orders (bí danh o): team của đơn theo thứ tự người dùng chọn, mỗi phần tử đủ thứ
 * `toPublic` cần. Thay cho populate("members") của bản cũ; leader là dòng có leader_position.
 */
const TEAM_COLUMN = sql.raw(`(
  SELECT json_group_array(json_object(
    'id', m.id, 'name', m.name, 'email', m.email, 'role', m.role, 'status', m.status,
    'skills', json(m.skills), 'leaderPosition', om.leader_position
  ) ORDER BY om.position, om.member_id)
  FROM order_members om JOIN members m ON m.id = om.member_id WHERE om.order_id = o.id
) AS team`);

/** Khách của đơn kèm trong cùng dòng (thay cho populate("client", "name contacts source tags")). */
const CLIENT_COLUMNS = sql.raw(
  "c.name AS client_name, c.contacts AS client_contacts, c.source AS client_source, c.tags AS client_tags"
);

/** Dòng orders (kèm cột team và các cột client_*) thành object cùng hình dạng với document cũ đã populate. */
const toOrder = (row) => {
  if (!row) return null;
  const order = Order.fromRow(row);
  order.team = JSON.parse(row.team || "[]");
  order.clientDoc = {
    id: row.client_id,
    name: row.client_name,
    contacts: JSON.parse(row.client_contacts || "[]"),
    source: row.client_source,
    tags: JSON.parse(row.client_tags || "[]"),
  };
  return order;
};

/** Id những người được chọn làm leader của đơn, theo thứ tự chọn. */
const leaderIdsOf = (team) =>
  team
    .filter((m) => m.leaderPosition !== null)
    .sort((a, b) => a.leaderPosition - b.leaderPosition)
    .map((m) => m.id);

const toPublic = (order) => {
  const leaderIds = new Set(leaderIdsOf(order.team));
  return {
    id: order.id,
    client: {
      id: order.clientDoc.id,
      name: order.clientDoc.name,
      contacts: order.clientDoc.contacts || [],
    },
    type: order.type,
    title: order.title,
    description: order.description || null,
    deadline: order.deadline || null,
    status: order.status,
    members: order.team.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      // "suspended": đang bị khóa, giao diện đánh dấu và không cho chọn mới.
      status: m.status,
      skills: m.skills,
      // Có quyền leader ở đơn này: được chọn làm leader của đơn, hoặc mang vai trò quản lý.
      isLeader:
        m.role === "manager" || (m.role === "staff" && leaderIds.has(m.id)),
    })),
    // Người được chọn làm leader của đúng đơn này (id). Quản lý không cần nằm ở đây vẫn có quyền leader.
    leaders: [...leaderIds],
    notes: order.notes || null,
    // Đơn đã từng bàn giao rồi được mở lại: sản phẩm khách đã duyệt được gửi vòng mới.
    reopenedAt: order.reopenedAt || null,
    createdBy: order.createdBy || null,
    deliveredAt: order.deliveredAt || null,
    version: order.version,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

const selectOrder = (where) => sql`
  SELECT o.*, ${TEAM_COLUMN}, ${CLIENT_COLUMNS}
  FROM orders o JOIN clients c ON c.id = o.client_id
  WHERE ${where}`;

async function findOrder(actor, id) {
  const order = toOrder(
    await first(selectOrder(sql`o.id = ${id} AND o.org_id = ${actor.orgId}`))
  );
  if (!order) throw new AppError("Không tìm thấy đơn hàng.", 404);
  return order;
}

/** Đọc lại đơn sau khi ghi, để trả đúng bản vừa lưu kèm khách và team. */
const readPublic = async (id) =>
  toPublic(toOrder(await first(selectOrder(sql`o.id = ${id}`))));

/**
 * Thành viên gán vào đơn: cùng tổ chức, không phải admin (admin thấy hết), không bị khóa.
 * keepIds: người đang ở sẵn trong team thì được giữ dù đang bị khóa, để vẫn sửa được team của đơn đó.
 * Trả { ids, roleOf }: roleOf là Map từ id sang vai trò, để kiểm luật leader mà không hỏi database lần nữa.
 */
async function resolveAssignableMembers(orgId, memberIds, keepIds = []) {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return { ids: [], roleOf: new Map() };
  const members = await all(sql`
    SELECT id, role, status FROM members
    WHERE id IN ${sql.list(unique)} AND org_id = ${orgId}`);
  if (members.length !== unique.length) {
    throw new AppError("Có thành viên không tồn tại.", 400);
  }
  if (members.some((m) => m.role === "admin")) {
    throw new AppError(
      "Quản trị viên thấy mọi đơn hàng nên không cần gán.",
      400
    );
  }
  const kept = new Set(keepIds);
  if (members.some((m) => m.status === "suspended" && !kept.has(m.id))) {
    throw new AppError("Không gán được thành viên đang bị tạm khóa.", 400);
  }
  return {
    ids: unique,
    roleOf: new Map(members.map((m) => [m.id, m.role])),
  };
}

/**
 * Guard cho lô: những điều resolveAssignableMembers vừa kiểm vẫn còn đúng lúc ghi (không ai trong danh sách vừa bị khóa,
 * vừa lên admin hay vừa đổi vai trò). Sai thì `transact` chạy lại `plan`, lần đó tự ra đúng lời báo.
 */
const assignableGuard = (orgId, ids, roleOf, orderId) => {
  const expected = ids.map((id) => ({ id, role: roleOf.get(id) }));
  // Việc miễn cho người đang bị khóa tính bằng SQL LÚC CHẠY LÔ (đang có dòng trong team của chính đơn này),
  // không theo danh sách `plan` đã đọc. Vai trò phải đúng như đã đọc: admin không bao giờ qua (plan đã từ chối admin),
  // và người vừa bị hạ xuống viewer hay vừa lên admin làm guard sai. Tạo đơn (chưa có orderId) thì không miễn ai.
  const stillInTeam = orderId
    ? sql`EXISTS (SELECT 1 FROM order_members om WHERE om.order_id = ${orderId} AND om.member_id = m.id)`
    : sql.raw("0");
  return guard(sql`
    SELECT 1 WHERE (
      SELECT count(*) FROM json_each(${JSON.stringify(expected)}) AS want
      JOIN members m ON m.id = json_extract(want.value, '$.id')
      WHERE m.org_id = ${orgId}
        AND m.role <> 'admin'
        AND m.role = json_extract(want.value, '$.role')
        AND (m.status <> 'suspended' OR ${stillInTeam})
    ) = ${ids.length}`);
};

/**
 * Guard cho lô: team của đơn vẫn đúng là team `plan` đã đọc (cùng những người, cùng ai là leader).
 * Cần riêng vì team không nằm trên bản ghi đơn: đổi vai trò một thành viên hay khôi phục chủ hệ thống sửa bảng
 * order_members mà không đổi orders.version, nên guard `stale` của đơn không thấy. Mọi điều `plan` suy ra từ team
 * (ai bị gỡ, leader hiện tại, người đang ở sẵn được giữ) dựa vào guard này.
 */
const teamUnchangedGuard = (orderId, team) => {
  const expected = team.map((m) => ({ m: m.id, l: m.leaderPosition }));
  return guard(sql`
    SELECT 1 WHERE (SELECT count(*) FROM order_members WHERE order_id = ${orderId}) = ${team.length}
      AND (
        SELECT count(*) FROM json_each(${JSON.stringify(expected)}) AS was
        JOIN order_members om ON om.order_id = ${orderId}
          AND om.member_id = json_extract(was.value, '$.m')
          AND om.leader_position IS json_extract(was.value, '$.l')
      ) = ${team.length}`);
};

/**
 * Guard cho lô: vai trò của những người này vẫn như `plan` đã đọc. Dùng cho người BỊ GỠ khỏi team:
 * luật "chỉ quản trị viên gỡ được quản lý" quyết định dựa vào vai trò của họ.
 */
const rolesUnchangedGuard = (members) =>
  guard(sql`
    SELECT 1 WHERE (
      SELECT count(*) FROM json_each(${JSON.stringify(members.map((m) => ({ id: m.id, role: m.role })))}) AS was
      JOIN members m ON m.id = json_extract(was.value, '$.id')
        AND m.role = json_extract(was.value, '$.role')
    ) = ${members.length}`);

/**
 * Leader của đơn: phải nằm trong team của đơn và là người làm được việc (nhân viên hoặc quản lý).
 * Người chỉ xem được đặt vai trò đó để không sửa gì, nên không làm leader; muốn thì đổi vai trò của họ trước.
 */
function resolveLeaders(leaderIds, roleOf) {
  const unique = [...new Set(leaderIds)];
  for (const id of unique) {
    const role = roleOf.get(id);
    if (!role) {
      throw new AppError("Leader phải nằm trong team của đơn.", 400);
    }
    if (role === "viewer") {
      throw new AppError(
        "Người chỉ xem không làm leader được. Hãy đổi vai trò của họ trước.",
        400
      );
    }
  }
  return unique;
}

/** Hai danh sách id có khác nhau không (không kể thứ tự). */
const differ = (a, b) => {
  const right = new Set(b);
  return a.length !== right.size || a.some((id) => !right.has(id));
};

/**
 * Câu ghi team của đơn: mỗi người một dòng trong order_members, vị trí theo thứ tự chọn, leader_position theo thứ tự leader.
 * Người đã ở sẵn giữ nguyên created_at (member.orders sắp theo created_at), chỉ đổi vị trí và leader.
 */
const upsertTeamStatement = (orderId, members, leaders, at) => {
  const rows = members.map((id, position) => {
    const leaderPosition = leaders.indexOf(id);
    return {
      m: id,
      p: position,
      l: leaderPosition < 0 ? null : leaderPosition,
    };
  });
  return sql`
    INSERT INTO order_members (order_id, member_id, position, leader_position, created_at)
    SELECT ${orderId}, json_extract(value, '$.m'), json_extract(value, '$.p'), json_extract(value, '$.l'), ${at}
    FROM json_each(${JSON.stringify(rows)})
    WHERE true
    ON CONFLICT (order_id, member_id) DO UPDATE SET
      position = excluded.position, leader_position = excluded.leader_position`;
};

// ---------- Tạo ----------

/** Tạo đơn. Khách cũ: clientId. Khách mới: client { name, contact } tạo ngay trong cùng lô. */
export async function createOrder(actor, input) {
  assertCan(actor, "order.create");
  const orderId = await transact(async () => {
    const statements = [];
    const at = now();
    let clientId = input.clientId;
    let clientCreated = false;

    if (clientId) {
      const exists = await first(
        sql`SELECT 1 FROM clients WHERE id = ${clientId} AND org_id = ${actor.orgId}`
      );
      if (!exists) throw new AppError("Khách hàng không tồn tại.", 400);
      statements.push(
        guard(
          sql`SELECT 1 FROM clients WHERE id = ${clientId} AND org_id = ${actor.orgId}`
        )
      );
    } else {
      clientId = newId();
      clientCreated = true;
    }

    // Leader được chọn thì tự nằm trong team, không cần chọn hai lần.
    const { ids: members, roleOf } = await resolveAssignableMembers(
      actor.orgId,
      [...input.memberIds, ...input.leaderIds]
    );
    const leaders = resolveLeaders(input.leaderIds, roleOf);
    if (members.length) {
      statements.push(assignableGuard(actor.orgId, members, roleOf));
    }

    if (clientCreated) {
      const source = input.client.source || "outreach";
      // Người liên hệ giữ khóa "_id" như document cũ: API trả nguyên mảng này và frontend gửi lại làm contactId.
      const contacts = input.client.contact
        ? [{ _id: newId(), ...input.client.contact, isPrimary: true }]
        : [];
      // Khách phải có trước đơn (khóa ngoại).
      statements.push(
        Client.insert({
          id: clientId,
          org: actor.orgId,
          name: input.client.name,
          contacts,
          source,
          tags: [],
          ...clientSearchColumns(input.client.name, contacts),
          createdAt: at,
          updatedAt: at,
        }),
        auditStatement({
          actor,
          action: "client.create",
          entityType: "client",
          entityId: clientId,
          after: { name: input.client.name, source },
        })
      );
    }

    const id = newId();
    statements.push(
      Order.insert({
        id,
        org: actor.orgId,
        client: clientId,
        type: input.type,
        title: input.title,
        description: input.description,
        deadline: toIso(input.deadline),
        notes: input.notes,
        createdBy: actor.memberId,
        titleSearch: toSearchText(input.title),
        createdAt: at,
        updatedAt: at,
      }),
      upsertTeamStatement(id, members, leaders, at),
      auditStatement({
        actor,
        action: "order.create",
        entityType: "order",
        entityId: id,
        orderId: id,
        after: {
          client: clientId,
          clientCreated,
          type: input.type,
          title: input.title,
          members,
          leaders,
        },
      })
    );
    return { statements, done: () => id };
  });
  return readPublic(orderId);
}

// ---------- Đọc ----------

/** Admin thấy mọi đơn; vai trò khác chỉ thấy đơn mình được gán. */
export async function listOrders(actor, query = {}) {
  const where = [sql`o.org_id = ${actor.orgId}`];
  if (actor.role !== "admin") {
    if (actor.orderIds.size === 0) return { orders: [], nextCursor: null };
    where.push(
      sql`o.id IN (SELECT order_id FROM order_members WHERE member_id = ${actor.memberId})`
    );
  }
  if (query.status) where.push(sql`o.status = ${query.status}`);
  if (query.type) where.push(sql`o.type = ${query.type}`);
  if (query.clientId) where.push(sql`o.client_id = ${query.clientId}`);
  if (query.search) {
    // Tìm theo tên đơn hoặc tên khách hàng (người dùng nhớ tên khách nhiều hơn tên đơn).
    where.push(
      sql.or([
        matches(sql.raw("o.title_search"), query.search),
        matches(sql.raw("c.name_search"), query.search),
      ])
    );
  }
  where.push(...beforeCursor(query, sql.raw("o.id")));

  const rows = await all(sql`
    ${selectOrder(sql.and(where))}
    ORDER BY o.id DESC LIMIT ${query.limit + 1}`);
  const { items, nextCursor } = pageOf(rows, query.limit);
  return { orders: items.map((row) => toPublic(toOrder(row))), nextCursor };
}

export async function getOrder(actor, id) {
  assertCan(actor, "order.read", { orderId: id });
  const order = await findOrder(actor, id);
  // Chi tiết đơn trả khách đầy đủ hơn danh sách (thêm nguồn và tag); các trường còn lại của khách xem ở /clients/:id.
  return {
    ...toPublic(order),
    client: {
      id: order.clientDoc.id,
      name: order.clientDoc.name,
      contacts: order.clientDoc.contacts || [],
      source: order.clientDoc.source,
      tags: order.clientDoc.tags || [],
      notes: null,
    },
  };
}

// ---------- Sửa ----------

export async function updateOrder(actor, id, input) {
  assertCan(actor, "order.update", { orderId: id });
  await transact(
    async () => {
      const order = await findOrder(actor, id);
      if (order.version !== input.version) throw STALE();
      // Đã có vòng review thì trạng thái do vòng quyết định (orderStatusService), không đặt tay nữa.
      if (input.status && !isManualStatus(order.status)) {
        throw new AppError(
          "Đơn đang theo vòng review, không đặt tay trạng thái được.",
          400
        );
      }

      const { version, ...fields } = input;
      if (fields.deadline !== undefined) {
        fields.deadline = toIso(fields.deadline);
      }
      const changes = { ...fields, updatedAt: now() };
      if (fields.title !== undefined) {
        changes.titleSearch = toSearchText(fields.title);
      }
      return {
        statements: [
          // version bao luôn trạng thái: trạng thái đơn đổi là version đổi.
          guard(
            sql`SELECT 1 FROM orders WHERE id = ${id} AND version = ${version}`,
            "stale"
          ),
          sql`UPDATE orders SET ${Order.set(changes)}, version = version + 1 WHERE id = ${id}`,
          auditStatement({
            actor,
            action: "order.update",
            entityType: "order",
            entityId: id,
            orderId: id,
            before: pick(order, Object.keys(fields)),
            after: fields,
          }),
        ],
      };
    },
    { errors: { stale: STALE } }
  );
  return readPublic(id);
}

/**
 * Thay toàn bộ team của đơn, kèm danh sách leader. Người bị gỡ mất quyền ngay request kế tiếp.
 * leaderIds bỏ trống thì giữ các leader hiện tại còn ở trong team. Leader được chọn tự nằm trong team.
 *
 * Quản trị viên đổi được mọi thứ. Leader của đơn chỉ thêm bớt được nhân viên và người chỉ xem:
 * không đổi danh sách leader, không thêm hay gỡ quản lý (quản lý có quyền leader), để leader không tự nhân quyền.
 */
export async function setOrderMembers(actor, id, input) {
  assertCan(actor, "order.team", { orderId: id });
  const dropped = await transact(
    async () => {
      const order = await findOrder(actor, id);
      if (order.version !== input.version) throw STALE();

      const current = order.team.map((m) => m.id);
      const currentLeaders = leaderIdsOf(order.team);
      const { ids: wanted, roleOf } = await resolveAssignableMembers(
        actor.orgId,
        [...input.memberIds, ...(input.leaderIds || [])],
        current
      );
      const leaders = resolveLeaders(
        input.leaderIds || currentLeaders.filter((m) => wanted.includes(m)),
        roleOf
      );
      const added = wanted.filter((m) => !current.includes(m));
      const removedMembers = order.team.filter((m) => !wanted.includes(m.id));
      const removed = removedMembers.map((m) => m.id);

      if (actor.role !== "admin") {
        if (differ(currentLeaders, leaders)) {
          throw new AppError("Chỉ quản trị viên đổi được leader của đơn.", 403);
        }
        if (
          removedMembers.some((m) => m.role === "manager") ||
          added.some((m) => roleOf.get(m) === "manager")
        ) {
          throw new AppError(
            "Chỉ quản trị viên thêm hoặc gỡ được quản lý khỏi đơn.",
            403
          );
        }
      }

      const at = now();
      const statements = [
        guard(
          sql`SELECT 1 FROM orders WHERE id = ${id} AND version = ${input.version}`,
          "stale"
        ),
        // Team vẫn là team đã đọc: version của đơn không đổi khi vai trò một người đổi, nên phải kiểm riêng.
        teamUnchangedGuard(id, order.team),
        // Vai trò và trạng thái của mọi người trong danh sách mới, và vai trò của người bị gỡ, vẫn như đã đọc.
        assignableGuard(actor.orgId, wanted, roleOf, id),
        rolesUnchangedGuard(removedMembers),
      ];
      statements.push(
        // Xóa theo danh sách MỚI (ai không còn trong đó thì ra), không theo danh sách "bị gỡ" tính lúc đọc.
        sql`DELETE FROM order_members WHERE order_id = ${id} AND member_id NOT IN ${sql.list(wanted)}`,
        upsertTeamStatement(id, wanted, leaders, at),
        sql`UPDATE orders SET version = version + 1, updated_at = ${at} WHERE id = ${id}`,
        // Người bị gỡ mất quyền với đơn: bỏ giao các góp ý còn dang dở của họ trong đơn này.
        unassignOpenWorkStatement({ memberIds: removed, orderId: id }),
        auditStatement({
          actor,
          action: "order.setMembers",
          entityType: "order",
          entityId: id,
          orderId: id,
          before: { members: current, leaders: currentLeaders },
          after: { members: wanted, leaders },
        })
      );
      return { statements, done: () => removed };
    },
    { errors: { stale: STALE } }
  );
  // Người bị gỡ đang nghe trực tiếp sản phẩm của đơn: ngắt kết nối, trình duyệt tự nối lại và xin nghe lại sẽ bị từ chối.
  dropped.forEach((memberId) => disconnectMember(memberId));
  return readPublic(id);
}

/**
 * Những người chọn được cho team của đơn, cho hộp "Sửa team". Ai sửa được team thì gọi được (quản trị viên, leader của đơn).
 * Gồm người đang ở trong team (kể cả đang bị khóa, để vẫn hiện và bỏ ra được) và người chưa ở trong team mà người gọi được thêm:
 * quản trị viên thêm được quản lý, nhân viên, người chỉ xem; leader chỉ thêm được nhân viên và người chỉ xem.
 * Chỉ trả thứ hộp chọn cần (tên, email, vai trò, trạng thái, kỹ năng), không trả cả hồ sơ thành viên.
 */
export async function listAssignableMembers(actor, id) {
  assertCan(actor, "order.team", { orderId: id });
  const order = await findOrder(actor, id);
  const addable =
    actor.role === "admin"
      ? ["manager", "staff", "viewer"]
      : ["staff", "viewer"];
  const teamIds = order.team.map((m) => m.id);
  // Người trong team đã có đủ trong lần đọc đơn (cột team); chỉ hỏi thêm những người chưa ở trong team.
  const others = (
    await all(sql`
      SELECT id, name, email, role, status, skills FROM members
      WHERE id NOT IN ${sql.list(teamIds)} AND org_id = ${actor.orgId}
        AND role IN ${sql.list(addable)} AND status <> 'suspended'
      ORDER BY id`)
  ).map((m) => ({ ...m, skills: JSON.parse(m.skills || "[]") }));
  const inTeam = new Set(teamIds);
  const leaderIds = new Set(leaderIdsOf(order.team));
  return (
    [...order.team, ...others]
      // Trùng tên thì theo id, để hai lần gọi cho cùng một thứ tự.
      .sort(
        (a, b) => a.name.localeCompare(b.name, "vi") || (a.id < b.id ? -1 : 1)
      )
      .map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        skills: m.skills,
        inTeam: inTeam.has(m.id),
        isLeader:
          m.role === "manager" || (m.role === "staff" && leaderIds.has(m.id)),
      }))
  );
}

/**
 * Bàn giao đơn: bước cuối, khi khách đã duyệt mọi sản phẩm (status approved).
 * Đơn không có sản phẩm nào đang hoạt động (ví dụ đơn video giao ngoài hệ thống) thì bàn giao tay được.
 * Sau bàn giao đơn đóng lại: không thêm sản phẩm, không mở vòng, khách không gửi thêm; muốn làm tiếp thì mở lại đơn.
 */
export async function deliverOrder(actor, id, input) {
  assertCan(actor, "order.update", { orderId: id });
  await transact(
    async () => {
      const order = await findOrder(actor, id);
      if (order.version !== input.version) throw STALE();
      if (order.status === "delivered") {
        throw new AppError("Đơn đã bàn giao rồi.", 409);
      }
      const statements = [
        guard(
          sql`SELECT 1 FROM orders WHERE id = ${id} AND version = ${input.version}`,
          "stale"
        ),
      ];
      if (order.status !== "approved") {
        const active = await first(
          sql`SELECT 1 FROM deliverables WHERE order_id = ${id} AND status = 'active' LIMIT 1`
        );
        if (active) {
          throw new AppError(
            "Chỉ bàn giao được khi khách đã duyệt mọi sản phẩm.",
            409
          );
        }
        // Thêm sản phẩm vào đơn không làm version của đơn đổi khi trạng thái giữ nguyên, nên phải chặn riêng.
        statements.push(
          guardNot(
            sql`SELECT 1 FROM deliverables WHERE order_id = ${id} AND status = 'active'`
          )
        );
      }
      const at = now();
      statements.push(
        sql`UPDATE orders SET ${Order.set({
          status: "delivered",
          deliveredAt: at,
          reopenedAt: null,
          updatedAt: at,
        })}, version = version + 1 WHERE id = ${id}`,
        auditStatement({
          actor,
          action: "order.deliver",
          entityType: "order",
          entityId: id,
          orderId: id,
          before: { status: order.status },
          after: { status: "delivered" },
        })
      );
      return { statements };
    },
    { errors: { stale: STALE } }
  );
  return readPublic(id);
}

/**
 * Mở lại đơn đã bàn giao (khách quay lại nhờ sửa thêm). Trạng thái tính lại theo các vòng review;
 * đơn không có vòng nào thì về in_progress. Sau khi mở lại, sản phẩm khách đã duyệt được "Gửi khách xem lại"
 * để mở vòng mới (roundService.openNextRound); không mở lại thì "đã duyệt" vẫn là chốt. Bản cũ sẽ được dọn lại 30 ngày sau lần bàn giao kế tiếp.
 */
export async function reopenOrder(actor, id, input) {
  assertCan(actor, "order.update", { orderId: id });
  await transact(
    async () => {
      const order = await findOrder(actor, id);
      if (order.version !== input.version) throw STALE();
      if (order.status !== "delivered") {
        throw new AppError("Chỉ mở lại được đơn đã bàn giao.", 409);
      }
      const at = now();
      return {
        statements: [
          guard(
            sql`SELECT 1 FROM orders WHERE id = ${id} AND version = ${input.version}`,
            "stale"
          ),
          sql`UPDATE orders SET ${Order.set({
            status: "in_progress",
            reopenedAt: at,
            deliveredAt: null,
            versionsPurgedAt: null,
            updatedAt: at,
          })}, version = version + 1 WHERE id = ${id}`,
          // Tính lại theo vòng review; đặt sau câu trên để thấy đơn đã rời "delivered".
          syncOrderStatusStatement(id),
          // Nhật ký đặt sau câu tính lại: trạng thái cuối chỉ biết lúc chạy.
          auditStatement({
            actor,
            action: "order.reopen",
            entityType: "order",
            entityId: id,
            orderId: id,
            before: { status: "delivered" },
            after: sql`json_object('status', (SELECT status FROM orders WHERE id = ${id}))`,
          }),
        ],
      };
    },
    { errors: { stale: STALE } }
  );
  return readPublic(id);
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}
