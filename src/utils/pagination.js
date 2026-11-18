import { sql } from "../db/d1.js";

/**
 * Phân trang theo con trỏ trên id giảm dần (id sắp theo thời gian tạo, xem utils/id.js).
 * Con trỏ là id của bản ghi cuối trang trước.
 *
 *   const where = [sql`org_id = ${actor.orgId}`, ...beforeCursor(query)];
 *   const rows = await all(sql`
 *     SELECT * FROM clients WHERE ${sql.and(where)} ORDER BY id DESC LIMIT ${query.limit + 1}`);
 *   const { items, nextCursor } = pageOf(rows, query.limit);
 */
export const beforeCursor = ({ cursor }, column = sql.raw("id")) =>
  cursor ? [sql`${column} < ${cursor}`] : [];

export const pageOf = (rows, limit) => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1].id) : null,
  };
};
