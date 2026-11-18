import { all, batch, guard, guardLabelOf, sql } from "../db/d1.js";
import { Deliverable, Round } from "../models/index.js";
import logger from "../utils/logger.js";
import { fromNow, now } from "../utils/time.js";
import * as storage from "./storageService.js";

/** Giữ các bản cũ tới 30 ngày sau khi bàn giao, rồi chỉ giữ bản cuối để kho không đầy. */
const KEEP_VERSIONS_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Mỗi lượt dọn tối đa chừng này đơn; còn lại để lượt sau (cron 6 giờ một lần).
 * Bản cũ dọn 20 đơn mỗi lượt và gọi kho từng file. Ở đây mỗi lượt cron chỉ có 10 ms CPU, nên dọn ít đơn hơn,
 * và KHÔNG gọi kho: chỉ sửa D1 rồi ghi file thừa vào thùng rác (storage_trash); việc dọn thùng rác xóa trên kho theo lô.
 */
const ORDERS_PER_RUN = 5;

/**
 * Với đơn đã bàn giao quá hạn: mỗi sản phẩm chỉ giữ bộ file của vòng cuối và file đang dùng,
 * các bản cũ vào thùng rác của kho. Góp ý cũ vẫn còn, nhưng không mở lại được trên bản đã dọn.
 * Mỗi đơn là một lô: sửa sản phẩm, sửa vòng, ghi thùng rác và đánh dấu đơn cùng thành hoặc cùng mất.
 * Trả số file đã đưa vào thùng rác.
 *
 * orderId: chỉ dọn đúng một đơn. KHI THỬ PHẢI TRUYỀN orderId, không thì mọi đơn đủ điều kiện đều bị dọn.
 */
export async function purgeDeliveredVersions(
  maxAgeMs = KEEP_VERSIONS_MS,
  orderId
) {
  const where = [
    sql`status = 'delivered'`,
    sql`delivered_at < ${fromNow(-maxAgeMs)}`,
    sql`versions_purged_at IS NULL`,
  ];
  if (orderId) where.push(sql`id = ${orderId}`);
  const orders = await all(sql`
    SELECT id FROM orders WHERE ${sql.and(where)} LIMIT ${ORDERS_PER_RUN}`);

  let deleted = 0;
  for (const order of orders) {
    const [deliverableRows, roundRows] = await Promise.all([
      all(
        sql`SELECT id, files, version FROM deliverables WHERE order_id = ${order.id}`
      ),
      all(
        sql`SELECT id, deliverable_id, number, files, pages FROM rounds WHERE order_id = ${order.id}`
      ),
    ]);
    const rounds = roundRows.map(Round.fromRow);
    const trash = [];
    const statements = [
      // Đơn vừa được mở lại (hoặc lượt khác vừa dọn xong) thì bỏ qua đơn này.
      guard(sql`
        SELECT 1 FROM orders
        WHERE id = ${order.id} AND status = 'delivered' AND versions_purged_at IS NULL`),
    ];

    for (const row of deliverableRows) {
      const d = Deliverable.fromRow(row);
      const mine = rounds.filter((round) => round.deliverable === d.id);
      const latest = mine.reduce(
        (best, round) => (!best || round.number > best.number ? round : best),
        null
      );
      const keep = new Set(latest?.files || []);
      for (const file of d.files || []) {
        if (!file.removedAt) keep.add(file.id);
      }
      // Sản phẩm web: chỉ giữ bộ ảnh chụp trang của vòng cuối.
      for (const round of mine) {
        if (round.id === latest?.id || (round.pages || []).length === 0) {
          continue;
        }
        statements.push(
          sql`UPDATE rounds SET pages = '[]', updated_at = ${now()} WHERE id = ${round.id}`
        );
        for (const page of round.pages) {
          trash.push({ provider: page.shot.provider, key: page.shot.key });
        }
      }

      const dropped = (d.files || []).filter((file) => !keep.has(file.id));
      if (dropped.length === 0) continue;
      statements.push(
        // Sản phẩm vừa bị sửa (đính, gỡ file) giữa lúc đọc và lúc ghi thì không ghi đè: để lượt sau.
        guard(
          sql`SELECT 1 FROM deliverables WHERE id = ${d.id} AND version = ${d.version}`
        ),
        // Không tăng version, như bản cũ: đây không phải thay đổi người dùng làm.
        sql`UPDATE deliverables SET ${Deliverable.set({
          files: d.files.filter((file) => keep.has(file.id)),
        })} WHERE id = ${d.id}`
      );
      for (const file of dropped) {
        trash.push({ provider: file.provider, key: file.key });
      }
    }

    statements.push(
      storage.trashStatement(trash),
      sql`UPDATE orders SET versions_purged_at = ${now()} WHERE id = ${order.id}`
    );
    try {
      await batch(statements);
      deleted += trash.length;
    } catch (err) {
      // Guard sai: dữ liệu vừa đổi, đơn này để lượt sau. Lỗi khác thì ném cho việc định kỳ ghi log.
      if (guardLabelOf(err) === null) throw err;
    }
  }
  if (deleted) logger.info({ deleted }, "Đã dọn bản cũ của đơn đã bàn giao");
  return deleted;
}
