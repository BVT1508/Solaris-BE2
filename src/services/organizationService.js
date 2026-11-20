import env from "../config/env.js";
import { batch, first, sql } from "../db/d1.js";
import { auditStatement } from "../utils/audit.js";
import { randomHex } from "../utils/hash.js";
import { now } from "../utils/time.js";

/**
 * Khóa nhúng chung của tổ chức ("nhúng script một lần, dùng cho mọi dự án").
 *
 * Mỗi sản phẩm web có khóa riêng (sdkKey), nên dự án nào người làm web cũng phải chép một đoạn script mới và hay quên.
 * Khóa chung thì dán MỘT lần vào bộ khung website của team: site nào mang khóa này cũng được nhận là site của tổ chức,
 * cho mọi sản phẩm web của tổ chức đó. Việc kiểm khóa nằm ở feedbackService.matchSdkKey: khóa site gửi lên hợp lệ khi
 * trùng khóa riêng của sản phẩm (như cũ) HOẶC trùng khóa chung của tổ chức sở hữu sản phẩm.
 *
 * An toàn: site nhúng khóa chung cho phép Solaris của tổ chức này điều khiển phần ghim góp ý trên site đó ở mọi sản phẩm
 * của tổ chức; đó là site do chính agency làm nên chấp nhận được. Khóa chung không bao giờ đi ra đường của khách
 * (khách chỉ nhận đúng hay sai khi hỏi khóa), và người chỉ xem không đọc được.
 */

/** Khóa nhúng: 32 ký tự hex thường, cùng dạng với sdkKey của sản phẩm (bridge và frontend chỉ nhận đúng dạng này). */
const newEmbedKey = () => randomHex(16);

/** Đoạn script dán vào bộ khung website. bridge.js do frontend phục vụ, cùng file với đoạn nhúng theo từng sản phẩm. */
const embedSnippet = (key) =>
  `<script src="${env.FRONTEND_URL}/bridge.js" data-key="${key}" async></script>`;

const toEmbed = (row) => ({
  key: row.embed_key,
  snippet: embedSnippet(row.embed_key),
  rotatedAt: row.embed_key_rotated_at || null,
});

const readEmbed = (orgId) =>
  first(
    sql`SELECT embed_key, embed_key_rotated_at FROM organizations WHERE id = ${orgId}`
  );

/**
 * Khóa nhúng chung của tổ chức người gọi. Chưa có thì sinh ngay ở lần đọc đầu tiên.
 * Câu ghi có điều kiện `embed_key IS NULL`: hai request cùng lúc thì chỉ một bên ghi được, bên kia đọc lại khóa đã ghi,
 * nên không bao giờ có hai khóa khác nhau được trả ra.
 */
export async function getEmbed(actor) {
  const current = await readEmbed(actor.orgId);
  if (current?.embed_key) return toEmbed(current);

  const created = await first(sql`
    UPDATE organizations SET embed_key = ${newEmbedKey()}, updated_at = ${now()}
    WHERE id = ${actor.orgId} AND embed_key IS NULL
    RETURNING embed_key, embed_key_rotated_at`);
  return toEmbed(created || (await readEmbed(actor.orgId)));
}

/**
 * Đổi khóa nhúng chung (chỉ quản trị viên, route đã chặn). Khóa cũ hết hiệu lực ngay: mọi site đang nhúng khóa chung
 * phải dán lại đoạn script mới. Đoạn script theo từng sản phẩm không bị ảnh hưởng.
 */
export async function rotateEmbed(actor) {
  const at = now();
  const [updated] = await batch([
    sql`UPDATE organizations SET embed_key = ${newEmbedKey()}, embed_key_rotated_at = ${at}, updated_at = ${at}
        WHERE id = ${actor.orgId}
        RETURNING embed_key, embed_key_rotated_at`,
    auditStatement({
      actor,
      action: "organization.rotateEmbedKey",
      entityType: "organization",
      entityId: actor.orgId,
    }),
  ]);
  return toEmbed(updated.rows[0]);
}
