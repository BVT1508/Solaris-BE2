import { all, first, guard, readAll, sql, transact } from "../db/d1.js";
import { Client } from "../models/index.js";
import { assertCan } from "../policies/policy.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { beforeCursor, pageOf } from "../utils/pagination.js";
import { matches, toSearchText } from "../utils/searchText.js";
import { now } from "../utils/time.js";

export const toPublicClient = (client) => ({
  id: client.id,
  name: client.name,
  contacts: client.contacts || [],
  source: client.source,
  tags: client.tags || [],
  notes: client.notes || null,
  version: client.version,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
});

/** Cột tìm kiếm của khách: tên, và tên cùng mọi người liên hệ (tên, điện thoại, email). Tính lại mỗi khi đổi tên hay người liên hệ. */
export const clientSearchColumns = (name, contacts = []) => ({
  nameSearch: toSearchText(name),
  searchText: toSearchText(
    name,
    contacts.flatMap((contact) => [contact.name, contact.phone, contact.email])
  ),
});

/** Tìm khách theo tên, điện thoại, email: dùng cho gợi ý khi tạo đơn và cho danh sách marketing. */
export async function listClients(actor, query = {}) {
  assertCan(actor, "client.manage");
  const where = [sql`org_id = ${actor.orgId}`];
  if (query.source) where.push(sql`source = ${query.source}`);
  if (query.tag) {
    where.push(
      sql`EXISTS (SELECT 1 FROM json_each(clients.tags) WHERE value = ${query.tag})`
    );
  }
  if (query.search) {
    where.push(matches(sql.raw("search_text"), query.search));
  }
  where.push(...beforeCursor(query));

  const rows = await all(sql`
    SELECT * FROM clients WHERE ${sql.and(where)}
    ORDER BY id DESC LIMIT ${query.limit + 1}`);
  const { items, nextCursor } = pageOf(rows, query.limit);
  return {
    clients: items.map((row) => toPublicClient(Client.fromRow(row))),
    nextCursor,
  };
}

export async function getClient(actor, id) {
  assertCan(actor, "client.manage");
  // Tóm tắt tương tác, tính từ đơn hàng; chưa có bảng lịch sử riêng.
  const [[row], orders] = await readAll([
    sql`SELECT * FROM clients WHERE id = ${id} AND org_id = ${actor.orgId}`,
    sql`SELECT id, type, status, title, deadline, created_at FROM orders
        WHERE client_id = ${id} ORDER BY id DESC`,
  ]);
  if (!row) throw new AppError("Không tìm thấy khách hàng.", 404);

  const byType = {};
  for (const order of orders) {
    byType[order.type] = (byType[order.type] || 0) + 1;
  }

  return {
    ...toPublicClient(Client.fromRow(row)),
    stats: {
      orderCount: orders.length,
      ordersByType: byType,
      lastOrderAt: orders[0]?.created_at || null,
    },
    orders: orders.map((order) => ({
      id: order.id,
      type: order.type,
      status: order.status,
      title: order.title,
      deadline: order.deadline || null,
      createdAt: order.created_at,
    })),
  };
}

export async function updateClient(actor, id, input) {
  assertCan(actor, "client.manage");
  return transact(
    async () => {
      const client = Client.fromRow(
        await first(
          sql`SELECT * FROM clients WHERE id = ${id} AND org_id = ${actor.orgId}`
        )
      );
      if (!client) throw new AppError("Không tìm thấy khách hàng.", 404);
      if (client.version !== input.version) throw STALE();

      const { version, ...fields } = input;
      const changes = { ...fields, updatedAt: now() };
      // Đổi tên thì hai cột tìm kiếm phải theo, không thì ô tìm vẫn ra tên cũ.
      if (fields.name !== undefined) {
        Object.assign(
          changes,
          clientSearchColumns(fields.name, client.contacts)
        );
      }
      return {
        statements: [
          guard(
            sql`SELECT 1 FROM clients WHERE id = ${id} AND version = ${version}`,
            "stale"
          ),
          sql`UPDATE clients SET ${Client.set(changes)}, version = version + 1
              WHERE id = ${id} RETURNING *`,
          auditStatement({
            actor,
            action: "client.update",
            entityType: "client",
            entityId: id,
            before: pick(client, Object.keys(fields)),
            after: fields,
          }),
        ],
        done: (results) => toPublicClient(Client.fromRow(results[1].rows[0])),
      };
    },
    { errors: { stale: STALE } }
  );
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}
