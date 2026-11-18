import {
  all,
  batch,
  guard,
  guardLabelOf,
  readAll,
  run,
  sql,
} from "../db/d1.js";
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

/** Đơn vẫn đủ điều kiện dọn: còn "delivered" và chưa có mốc đã dọn. Mở lại đơn xóa mốc và đổi trạng thái. */
const stillPurgeable = (orderId) => sql`
  SELECT 1 FROM orders
  WHERE id = ${orderId} AND status = 'delivered' AND versions_purged_at IS NULL`;

/**
 * Lô dọn MỘT sản phẩm, hoặc null khi sản phẩm không có gì để dọn. Trả { statements, files }.
 * Đầu lô khẳng định lại mọi điều vừa đọc: đơn còn đủ điều kiện, sản phẩm chưa ai sửa (version), vòng mới nhất vẫn là
 * vòng đã đọc. Không có các guard này thì việc dọn ghi đè `files` cũ lên file nhân viên vừa đính, hoặc dọn một đơn
 * vừa được mở lại. Sửa `files` thì tăng version của sản phẩm, để thao tác đính hay gỡ file đang dở của ai đó
 * (đọc version cũ) nhận 409 thay vì ghi lại mục file mà kho sắp xóa.
 */
function purgePlanFor(orderId, d, rounds) {
  const latest = rounds.reduce(
    (best, round) => (!best || round.number > best.number ? round : best),
    null
  );
  const keep = new Set(latest?.files || []);
  for (const file of d.files || []) {
    if (!file.removedAt) keep.add(file.id);
  }
  // Sản phẩm web: chỉ giữ bộ ảnh chụp trang của vòng cuối.
  const olderWithPages = rounds.filter(
    (round) => round.id !== latest?.id && (round.pages || []).length > 0
  );
  const dropped = (d.files || []).filter((file) => !keep.has(file.id));
  if (olderWithPages.length === 0 && dropped.length === 0) return null;

  const at = now();
  const trash = [
    ...olderWithPages.flatMap((round) =>
      round.pages.map((page) => ({
        provider: page.shot.provider,
        key: page.shot.key,
      }))
    ),
    ...dropped.map((file) => ({ provider: file.provider, key: file.key })),
  ];
  const statements = [
    guard(stillPurgeable(orderId)),
    guard(
      sql`SELECT 1 FROM deliverables WHERE id = ${d.id} AND version = ${d.version}`
    ),
    // Vòng mới nhất vẫn là vòng đã đọc (không có vòng nào thì vẫn chưa có vòng nào).
    guard(sql`
      SELECT 1 WHERE (SELECT MAX(number) FROM rounds WHERE deliverable_id = ${d.id})
        IS ${latest ? latest.number : null}`),
    ...olderWithPages.map(
      (round) =>
        sql`UPDATE rounds SET pages = '[]', updated_at = ${at} WHERE id = ${round.id}`
    ),
  ];
  if (dropped.length > 0) {
    statements.push(
      sql`UPDATE deliverables SET ${Deliverable.set({
        files: d.files.filter((file) => keep.has(file.id)),
        updatedAt: at,
      })}, version = version + 1 WHERE id = ${d.id}`
    );
  }
  statements.push(storage.trashStatement(trash));
  return { statements, files: trash.length };
}

/**
 * Với đơn đã bàn giao quá hạn: mỗi sản phẩm chỉ giữ bộ file của vòng cuối và file đang dùng,
 * các bản cũ vào thùng rác của kho. Góp ý cũ vẫn còn, nhưng không mở lại được trên bản đã dọn.
 * Mỗi sản phẩm một lô có guard (xem purgePlanFor). Mốc "đã dọn" của đơn chỉ đặt khi mọi sản phẩm của đơn đã qua,
 * và chỉ khi đơn vẫn còn "delivered". Sản phẩm nào guard sai (dữ liệu vừa đổi) thì cả đơn để lượt sau.
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
    SELECT id FROM orders WHERE ${sql.and(where)} ORDER BY id LIMIT ${ORDERS_PER_RUN}`);

  let deleted = 0;
  for (const order of orders) {
    const [deliverableRows, roundRows] = await readAll([
      sql`SELECT id, files, version FROM deliverables WHERE order_id = ${order.id} ORDER BY id`,
      sql`SELECT id, deliverable_id, number, files, pages
          FROM rounds WHERE order_id = ${order.id} ORDER BY number`,
    ]);
    const rounds = roundRows.map(Round.fromRow);

    let complete = true;
    for (const row of deliverableRows) {
      const d = Deliverable.fromRow(row);
      const plan = purgePlanFor(
        order.id,
        d,
        rounds.filter((round) => round.deliverable === d.id)
      );
      if (!plan) continue;
      try {
        await batch(plan.statements);
        deleted += plan.files;
      } catch (err) {
        // Guard sai: dữ liệu vừa đổi, đơn này để lượt sau. Lỗi khác thì ném cho việc định kỳ ghi log.
        if (guardLabelOf(err) === null) throw err;
        complete = false;
        break;
      }
    }
    if (complete) {
      // Mốc đặt có điều kiện: đơn vừa được mở lại thì không đánh dấu.
      await run(sql`
        UPDATE orders SET versions_purged_at = ${now()}
        WHERE id = ${order.id} AND status = 'delivered' AND versions_purged_at IS NULL`);
    }
  }
  if (deleted) logger.info({ deleted }, "Đã dọn bản cũ của đơn đã bàn giao");
  return deleted;
}
