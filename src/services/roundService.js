import {
  all,
  first,
  guard,
  guardNot,
  readAll,
  sql,
  transact,
} from "../db/d1.js";
import { Deliverable, Round } from "../models/index.js";
import { assertCan } from "../policies/policy.js";
import AppError from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { newId } from "../utils/id.js";
import { notifyFeedback } from "../utils/realtime.js";
import { now } from "../utils/time.js";
import {
  activeFiles,
  findDeliverable,
  toPublicPages,
} from "./deliverableService.js";
import { assertCanComment, assertSameSite } from "./feedbackRules.js";
import {
  orderNotDeliveredGuard,
  orderStatusOf,
  syncOrderStatusStatement,
} from "./orderStatusService.js";
import * as storage from "./storageService.js";

/** Dạng trả ra của một vòng review, cho cả team lẫn khách. */
export const toPublicRound = (round) =>
  round
    ? {
        id: round.id,
        deliverableId: round.deliverable,
        number: round.number,
        status: round.status,
        note: round.note || null,
        // Bộ file khách được xem trong vòng này, theo thứ tự. url: địa chỉ site lúc mở vòng.
        fileIds: round.files || [],
        url: round.url || null,
        openedAt: round.openedAt,
        submittedAt: round.submittedAt || null,
        approvedAt: round.approvedAt || null,
      }
    : null;

/** Bản chụp lúc mở vòng: bộ file đang dùng theo thứ tự, và địa chỉ site với sản phẩm web. */
export const snapshotOf = (deliverable) => ({
  files: activeFiles(deliverable).map((f) => f.id),
  ...(deliverable.url && { url: deliverable.url }),
});

/** Sản phẩm ảnh, PDF phải có file thì mới có gì để gửi khách. */
function assertHasContent(deliverable) {
  if (deliverable.type !== "web" && activeFiles(deliverable).length === 0) {
    throw new AppError("Sản phẩm chưa có file để gửi khách.", 400);
  }
}

const latestRound = async (deliverableId) =>
  Round.fromRow(
    await first(sql`
      SELECT * FROM rounds WHERE deliverable_id = ${deliverableId}
      ORDER BY number DESC LIMIT 1`)
  );

const NOT_SHARED = () =>
  new AppError("Sản phẩm chưa chia sẻ lần nào. Tạo link chia sẻ trước.", 400);

/** Điều kiện "góp ý khách thấy được của sản phẩm", dùng lại ở các câu đếm. */
const customerFeedback = (deliverableId) =>
  sql`deliverable_id = ${deliverableId} AND visibility = 'customer'`;

// ---------- Khách khép vòng ----------

const ROUND_CLOSED = () =>
  new AppError("Vòng góp ý đã khép. Chờ team gửi bản sửa để góp ý tiếp.", 409);

/**
 * Khách bấm "Gửi góp ý cho team": mọi nháp của vòng thành open (khóa nội dung và vị trí),
 * vòng khép lại (submitted), đơn sang revising. Từ lúc này team mới thấy góp ý.
 */
export async function submitByGuest(guest) {
  const { link, deliverable, round } = guest;
  assertCan(guest.actor, "feedback.create", { deliverableId: deliverable.id });
  assertCanComment(guest);

  const drafts = sql`SELECT 1 FROM feedback WHERE deliverable_id = ${deliverable.id} AND status = 'draft'`;
  // Bài khách vừa bấm "Cần sửa tiếp" trong vòng này cũng là nội dung để gửi, dù không có nháp mới.
  // Tính cả khi team đã kịp nhận bài (in_progress) hoặc báo sửa lại (done): khách đã nói "chưa ổn" trong vòng này
  // thì phải khép được vòng, không thể bị báo "chưa có góp ý nào để gửi".
  const reopenedWhere = sql`${customerFeedback(deliverable.id)}
    AND status IN ('open', 'in_progress', 'done') AND reopened_round_number = ${round.number}`;

  const result = await transact(
    async () => {
      const at = now();
      return {
        statements: [
          // Vòng trước, nội dung sau: hai người cùng bấm gửi thì người sau nhận đúng lời báo "vòng đã khép"
          // (chứ không phải "chưa có góp ý", vì nháp đã được người trước gửi đi).
          guard(
            sql`SELECT 1 FROM rounds WHERE id = ${round.id} AND status = 'open'`,
            "closed"
          ),
          // Không có gì để gửi: cả lô hoàn tác, vòng vẫn mở.
          guard(
            sql`SELECT 1 WHERE EXISTS (${drafts})
                OR EXISTS (SELECT 1 FROM feedback WHERE ${reopenedWhere})`,
            "empty"
          ),
          // Nhật ký đặt TRƯỚC câu gửi nháp: số nháp được gửi chỉ đếm được khi chúng còn là nháp.
          auditStatement({
            actor: guest.actor,
            action: "round.submit",
            entityType: "round",
            entityId: round.id,
            orderId: link.order,
            deliverableId: deliverable.id,
            after: sql`json_object(
              'deliverable', ${deliverable.id},
              'number', ${round.number},
              'feedback', (SELECT count(*) FROM feedback WHERE deliverable_id = ${deliverable.id} AND status = 'draft'),
              'reopened', (SELECT count(*) FROM feedback WHERE ${reopenedWhere}))`,
          }),
          sql`UPDATE rounds SET ${Round.set({
            status: "submitted",
            submittedAt: at,
            submittedByLink: link.id,
            updatedAt: at,
          })} WHERE id = ${round.id} RETURNING *`,
          // Mọi nháp của sản phẩm, không lọc theo vòng: nháp còn sót từ vòng trước (không kịp đi cùng lượt gửi cũ)
          // được dời sang vòng này và gửi luôn, không nằm lại mãi.
          sql`UPDATE feedback SET status = 'open', submitted_at = ${at}, round_id = ${round.id},
                round_number = ${round.number}, version = version + 1, updated_at = ${at}
              WHERE deliverable_id = ${deliverable.id} AND status = 'draft'`,
          sql`SELECT count(*) AS n FROM feedback WHERE ${reopenedWhere}`,
          syncOrderStatusStatement(link.order),
        ],
        done: (results) => ({
          round: toPublicRound(Round.fromRow(results[3].rows[0])),
          submitted: results[4].changes,
          reopened: results[5].rows[0].n,
          orderStatus: orderStatusOf(results[6]),
        }),
      };
    },
    {
      errors: {
        closed: ROUND_CLOSED,
        empty: () =>
          new AppError(
            "Chưa có góp ý nào để gửi. Nếu sản phẩm đã ổn, hãy bấm Duyệt.",
            400
          ),
      },
    }
  );
  // Team đang mở sản phẩm thấy ngay góp ý khách vừa gửi; máy khác của khách thấy vòng đã khép.
  notifyFeedback({
    deliverableId: deliverable.id,
    kind: "submitted",
    visibility: "customer",
    actor: guest.actor,
  });
  return result;
}

/**
 * Khách bấm "Duyệt": vòng thành approved, các góp ý team đã báo sửa xong thành confirmed.
 * Còn nháp chưa gửi thì phải gửi hoặc xóa trước. Mọi sản phẩm của đơn được duyệt thì đơn sang approved.
 */
export async function approveByGuest(guest) {
  const { link, deliverable, round } = guest;
  assertCan(guest.actor, "feedback.create", { deliverableId: deliverable.id });
  assertCanComment(guest);

  const draftsWhere = sql`deliverable_id = ${deliverable.id} AND status = 'draft'`;
  const doneWhere = sql`${customerFeedback(deliverable.id)} AND status = 'done'`;
  const remainingWhere = sql`${customerFeedback(deliverable.id)} AND status IN ('open', 'in_progress')`;

  const result = await transact(
    async () => {
      const drafts = await all(
        sql`SELECT share_link_id FROM feedback WHERE ${draftsWhere}`
      );
      if (drafts.length > 0) {
        // Nháp soạn qua link khác thì người này không thấy: nói rõ để họ khỏi tìm trên màn hình của mình.
        const others = drafts.filter(
          (fb) => fb.share_link_id !== link.id
        ).length;
        throw new AppError(
          others === drafts.length
            ? `Còn ${others} góp ý nháp của người khác chưa gửi. Bấm "Gửi góp ý cho team" để gửi kèm, hoặc nhờ họ xóa trước khi duyệt.`
            : "Còn góp ý nháp chưa gửi. Gửi cho team hoặc xóa trước khi duyệt.",
          400
        );
      }

      const at = now();
      return {
        statements: [
          // Ai đó vừa soạn nháp giữa lúc đọc và lúc ghi: chạy lại, lần đó báo đúng lời "còn nháp".
          guardNot(sql`SELECT 1 FROM feedback WHERE ${draftsWhere}`),
          guard(
            sql`SELECT 1 FROM rounds WHERE id = ${round.id} AND status = 'open'`,
            "closed"
          ),
          // Nhật ký đặt TRƯỚC câu xác nhận: số bài được xác nhận chỉ đếm được khi chúng còn là "done".
          auditStatement({
            actor: guest.actor,
            action: "round.approve",
            entityType: "round",
            entityId: round.id,
            orderId: link.order,
            deliverableId: deliverable.id,
            after: sql`json_object(
              'deliverable', ${deliverable.id},
              'number', ${round.number},
              'confirmed', (SELECT count(*) FROM feedback WHERE ${doneWhere}),
              'remaining', (SELECT count(*) FROM feedback WHERE ${remainingWhere}))`,
          }),
          sql`UPDATE rounds SET ${Round.set({
            status: "approved",
            approvedAt: at,
            approvedByLink: link.id,
            updatedAt: at,
          })} WHERE id = ${round.id} RETURNING *`,
          sql`UPDATE feedback SET status = 'confirmed', confirmed_at = ${at},
                version = version + 1, updated_at = ${at}
              WHERE ${doneWhere}`,
          // Việc còn dang dở sau khi khách duyệt: team tự dọn, không chặn việc duyệt.
          sql`SELECT count(*) AS n FROM feedback WHERE ${remainingWhere}`,
          syncOrderStatusStatement(link.order),
        ],
        done: (results) => ({
          round: toPublicRound(Round.fromRow(results[3].rows[0])),
          confirmed: results[4].changes,
          remaining: results[5].rows[0].n,
          orderStatus: orderStatusOf(results[6]),
        }),
      };
    },
    {
      errors: {
        closed: () =>
          new AppError("Sản phẩm đã được duyệt hoặc vòng đã khép.", 409),
      },
    }
  );
  notifyFeedback({
    deliverableId: deliverable.id,
    kind: "approved",
    visibility: "customer",
    actor: guest.actor,
  });
  return result;
}

// ---------- Team mở vòng kế, cập nhật bản đang gửi ----------

/**
 * Leader của đơn (hoặc quản trị viên) bấm "Gửi khách xem lại": mở vòng kế trên cùng link. Nhân viên sửa xong thì báo "đã sửa",
 * leader xem rồi mới gửi. Chỉ mở được khi khách đã gửi góp ý của vòng trước.
 * Góp ý chưa xong của vòng trước vẫn hiện ở vòng sau; trả kèm số bài còn dang dở để team cân nhắc.
 */
export async function openNextRound(actor, deliverableId, input = {}) {
  const plan = async () => {
    const d = await findDeliverable(actor, deliverableId);
    assertCan(actor, "round.create", { orderId: d.order });
    if (d.status === "archived") {
      throw new AppError(
        "Sản phẩm đã lưu trữ, khôi phục trước khi gửi khách.",
        400
      );
    }
    const [[order], [latestRow]] = await readAll([
      sql`SELECT status, reopened_at FROM orders WHERE id = ${d.order}`,
      sql`SELECT * FROM rounds WHERE deliverable_id = ${d.id} ORDER BY number DESC LIMIT 1`,
    ]);
    if (order?.status === "delivered") {
      throw new AppError(
        "Đơn đã bàn giao. Mở lại đơn trước khi làm tiếp.",
        409
      );
    }
    const latest = Round.fromRow(latestRow);
    if (!latest) throw NOT_SHARED();
    if (latest.status === "open") {
      throw new AppError("Vòng hiện tại còn mở, khách chưa gửi góp ý.", 409);
    }
    // Khách đã duyệt là chốt, trừ khi đơn đã bàn giao rồi được mở lại để sửa thêm.
    if (latest.status === "approved" && !order?.reopened_at) {
      throw new AppError("Sản phẩm đã được khách duyệt.", 409);
    }
    assertHasContent(d);

    const at = now();
    const round = {
      id: newId(),
      org: actor.orgId,
      order: d.order,
      deliverable: d.id,
      number: latest.number + 1,
      status: "open",
      openedBy: actor.memberId,
      openedAt: at,
      ...snapshotOf(d),
      note: input.note,
      createdAt: at,
      updatedAt: at,
    };
    const pendingCount = (status) =>
      sql`(SELECT count(*) FROM feedback WHERE ${customerFeedback(d.id)} AND status = ${status})`;
    return {
      statements: [
        // Bộ file chụp vào vòng phải đúng là bộ đang có: ai đó gỡ hay thay file (hoặc lưu trữ sản phẩm) cùng lúc làm version đổi.
        guard(
          sql`SELECT 1 FROM deliverables WHERE id = ${d.id} AND version = ${d.version}`
        ),
        orderNotDeliveredGuard(d.order),
        // Vòng mới nhất vẫn là vòng đã đọc và chưa đổi trạng thái.
        guard(sql`
          SELECT 1 FROM rounds WHERE id = ${latest.id} AND status = ${latest.status}
            AND number = (SELECT MAX(number) FROM rounds WHERE deliverable_id = ${d.id})`),
        Round.insert(round),
        syncOrderStatusStatement(d.order),
        sql`SELECT ${pendingCount("open")} AS open, ${pendingCount("in_progress")} AS in_progress,
              ${pendingCount("done")} AS done`,
        auditStatement({
          actor,
          action: "round.open",
          entityType: "round",
          entityId: round.id,
          orderId: d.order,
          deliverableId: d.id,
          after: sql`json_object('deliverable', ${d.id}, 'number', ${round.number},
            'pending', json_object('open', ${pendingCount("open")},
              'in_progress', ${pendingCount("in_progress")}, 'done', ${pendingCount("done")}))`,
        }),
      ],
      done: (results) => {
        const counts = results[5].rows[0];
        return {
          round: toPublicRound(round),
          orderStatus: orderStatusOf(results[4]),
          pending: {
            open: counts.open,
            in_progress: counts.in_progress,
            done: counts.done,
          },
        };
      },
    };
  };

  // Hai người mở cùng lúc: guard "vòng mới nhất vẫn là vòng đã đọc" của người sau sai, `transact` chạy lại `plan`
  // và lần đó báo "Vòng hiện tại còn mở...". Chỉ mục duy nhất (sản phẩm, số vòng) chỉ còn là lưới cuối.
  const result = await transact(plan);
  // Khách đang mở link thấy ngay bản mới của vòng vừa mở.
  notifyFeedback({
    deliverableId,
    kind: "round",
    visibility: "customer",
    actor,
  });
  return result;
}

/**
 * "Cập nhật bản đang gửi": chụp lại bộ file cho vòng đang mở, dùng khi team tải nhầm ngay sau khi gửi.
 * Chỉ được khi vòng còn mở và chưa ai góp ý trên vòng đó (kể cả nháp); đã có góp ý thì phải gửi bản mới
 * bằng "Gửi khách xem lại" để không làm lệch góp ý với bản khách đã xem.
 */
export async function refreshCurrentRound(actor, deliverableId) {
  const TOUCHED = () =>
    new AppError(
      "Khách đã góp ý trên bản này. Gửi bản mới bằng Gửi khách xem lại.",
      409
    );
  let dropped = 0;
  const result = await transact(
    async () => {
      const d = await findDeliverable(actor, deliverableId);
      assertCan(actor, "round.create", { orderId: d.order });

      const latest = await latestRound(d.id);
      if (!latest) throw NOT_SHARED();
      if (latest.status !== "open") {
        throw new AppError(
          "Vòng hiện tại đã khép. Gửi bản mới bằng Gửi khách xem lại.",
          409
        );
      }
      const [touched, otherRounds, pinned] = await readAll([
        sql`SELECT 1 FROM feedback WHERE round_id = ${latest.id} LIMIT 1`,
        sql`SELECT files FROM rounds WHERE deliverable_id = ${d.id} AND id <> ${latest.id}`,
        sql`SELECT DISTINCT target_file_id AS id FROM feedback
            WHERE deliverable_id = ${d.id} AND target_file_id IS NOT NULL`,
      ]);
      if (touched.length > 0) throw TOUCHED();
      assertHasContent(d);

      const snapshot = snapshotOf(d);
      // File đã gỡ mà giờ không còn vòng nào giữ và không có góp ý: xóa hẳn.
      // Vòng đang mở sắp nhận bộ file mới (toàn file đang dùng), nên chỉ còn các vòng khác giữ được file đã gỡ.
      const retained = new Set([
        ...otherRounds.flatMap((round) => JSON.parse(round.files || "[]")),
        ...pinned.map((row) => row.id),
      ]);
      const kept = [];
      const cleanup = [];
      for (const file of d.files || []) {
        if (!file.removedAt || retained.has(file.id)) kept.push(file);
        else cleanup.push(file);
      }

      const at = now();
      const statements = [
        guard(
          sql`SELECT 1 FROM deliverables WHERE id = ${d.id} AND version = ${d.version}`
        ),
        guard(
          sql`SELECT 1 FROM rounds WHERE id = ${latest.id} AND status = 'open'`
        ),
        guardNot(
          sql`SELECT 1 FROM feedback WHERE round_id = ${latest.id}`,
          "touched"
        ),
        // Khách vừa ghim lên một file sắp xóa hẳn: chạy lại, lần đó file được giữ.
        ...cleanup.map((file) =>
          guardNot(sql`
            SELECT 1 FROM feedback
            WHERE deliverable_id = ${d.id} AND target_file_id = ${file.id}`)
        ),
        sql`UPDATE rounds SET ${Round.set({ ...snapshot, updatedAt: at })}
            WHERE id = ${latest.id} RETURNING *`,
      ];
      if (cleanup.length > 0) {
        statements.push(
          sql`UPDATE deliverables SET ${Deliverable.set({ files: kept, updatedAt: at })},
                version = version + 1 WHERE id = ${d.id}`
        );
      }
      statements.push(
        auditStatement({
          actor,
          action: "round.refresh",
          entityType: "round",
          entityId: latest.id,
          orderId: d.order,
          deliverableId: d.id,
          before: { files: latest.files || null },
          after: { files: snapshot.files, dropped: cleanup.length },
        }),
        storage.trashStatement(cleanup)
      );
      const updateAt = 3 + cleanup.length;
      return {
        statements,
        done: (results) => {
          dropped = cleanup.length;
          return {
            round: toPublicRound(Round.fromRow(results[updateAt].rows[0])),
          };
        },
      };
    },
    { errors: { touched: TOUCHED } }
  );
  if (dropped > 0) storage.emptyTrashSoon();
  return result;
}

// ---------- Sản phẩm web: bản chụp trang theo vòng ----------

/** Ảnh cả trang dài hơn ảnh khung nhìn nên cho tới 10 MB. */
const PAGE_SHOT_MAX_BYTES = 10 * 1024 * 1024;
const PAGE_SHOT_ERROR =
  "Ảnh chụp trang phải là PNG, JPG hoặc WebP, tối đa 10 MB.";

/** Sản phẩm web mà người gọi được lưu bộ ảnh trang (ai làm việc trong đơn). */
async function findWebForRound(actor, deliverableId) {
  const d = await findDeliverable(actor, deliverableId);
  // Bộ ảnh do trình duyệt của người đang mở màn góp ý chụp, nên nhân viên cũng lưu được (khác với mở vòng: chỉ leader).
  assertCan(actor, "round.pages", { orderId: d.order });
  if (d.type !== "web") {
    throw new AppError("Chỉ sản phẩm web mới có ảnh chụp trang.", 400);
  }
  return d;
}

/** Bước 1: team xin chỗ đẩy ảnh chụp cả trang (bridge chụp trong trình duyệt của team). */
export async function createShotUpload(actor, deliverableId, input) {
  const d = await findWebForRound(actor, deliverableId);
  const rule = storage.ruleFor(input.contentType);
  if (!rule || rule.kind !== "image" || input.bytes > PAGE_SHOT_MAX_BYTES) {
    throw new AppError(PAGE_SHOT_ERROR, 400);
  }
  storage.assertStorageEnabled();
  const key = storage.pendingKey(d.id, rule.ext);
  return storage.createUpload(key, rule, input.contentType, input.bytes);
}

/** Nhận một ảnh chụp trang đã đẩy lên kho: kiểm có thật, là ảnh, không quá cỡ, rồi chuyển sang key chính thức. */
async function adoptPageShot(d, key) {
  if (!storage.pendingKeyPattern(d.id).test(key)) {
    throw new AppError("Ảnh chụp không thuộc sản phẩm này.", 400);
  }
  const provider = storage.activeProvider();
  // MỘT lời gọi kho cho mỗi ảnh: chuyển key và nhận luôn loại, cỡ, kích thước (bản cũ hỏi rồi mới chuyển, hai lời gọi).
  // Một vòng tối đa 30 trang, mà gói miễn phí chỉ cho 50 lời gọi ra ngoài mỗi request.
  const finalKey = storage.pageShotKey(d.order, d.id, storage.extOfKey(key));
  const info = await storage.adoptPending(key, finalKey);
  if (!info) throw new AppError("Chưa thấy ảnh chụp trên kho.", 400);
  // Kiểm loại và cỡ SAU khi nhận; sai thì đưa key chính thức vào thùng rác.
  const rule = storage.ruleFor(info.contentType);
  if (!rule || rule.kind !== "image" || info.bytes > PAGE_SHOT_MAX_BYTES) {
    await storage.trashQuietly([{ provider, key: finalKey }]);
    throw new AppError(PAGE_SHOT_ERROR, 400);
  }
  return {
    provider,
    key: finalKey,
    contentType: info.contentType,
    bytes: info.bytes,
    ...info.measured,
  };
}

const PAGES_LOCKED_ERROR =
  "Bản của vòng này đã khóa từ lúc khách gửi góp ý. Chỉ thêm được trang còn thiếu.";

const sameShotSlot = (a, b) =>
  a.pageUrl === b.pageUrl && (a.docSize?.w || null) === (b.docSize?.w || null);

/**
 * Vòng khách đã gửi (submitted) thì bộ ảnh là "bản khách đã xem": site sửa tại chỗ nên chụp lại
 * sẽ ra site đã sửa, mất bản để đối chiếu. Vì vậy không được bỏ hay thay ảnh của trang đã có,
 * cũng không được chụp thêm một ảnh trùng trang và bề rộng với ảnh đã có. Chỉ thêm trang còn thiếu.
 */
function assertPagesUnlocked(latest, input) {
  const current = latest.pages || [];
  const keptIds = new Set(
    input.pages.filter((page) => page.id).map((page) => page.id)
  );
  const dropsOne = current.some((page) => !keptIds.has(page.id));
  const retakesOne = input.pages.some(
    (page) => page.shotKey && current.some((old) => sameShotSlot(old, page))
  );
  if (dropsOne || retakesOne) throw new AppError(PAGES_LOCKED_ERROR, 409);
}

/**
 * Bước 2: lưu bộ ảnh chụp trang của vòng mới nhất.
 * Mỗi trang gửi shotKey (ảnh vừa đẩy) hoặc id (giữ ảnh của trang đang có, chỉ đổi ghim).
 * Vòng còn mở: thay tự do (pages rỗng thì xóa bộ ảnh). Vòng khách đã gửi: bộ ảnh đã khóa (xem assertPagesUnlocked),
 * ảnh thêm vào lúc này được đánh dấu late vì có thể đã lẫn phần team sửa. `force` (người dùng chủ ý chụp lại)
 * bỏ qua khóa nhưng ảnh mới vẫn mang late. Vòng đã được khách duyệt thì không sửa nữa.
 * Ảnh không còn được dùng vào thùng rác của kho. Ghim trỏ tới góp ý không thuộc sản phẩm này thì bỏ qua.
 */
export async function setCurrentPages(actor, deliverableId, input) {
  const d = await findWebForRound(actor, deliverableId);
  const latest = await latestRound(d.id);
  if (!latest) throw NOT_SHARED();
  if (latest.status === "approved") {
    throw new AppError("Sản phẩm đã được khách duyệt.", 409);
  }
  for (const page of input.pages) assertSameSite(d.url, page.pageUrl);

  const existing = new Map((latest.pages || []).map((page) => [page.id, page]));
  for (const page of input.pages) {
    if (page.id && !existing.has(page.id)) {
      throw new AppError("Trang không thuộc vòng hiện tại.", 400);
    }
  }
  const locked = latest.status === "submitted";
  if (locked && !input.force) assertPagesUnlocked(latest, input);
  if (input.pages.some((page) => page.shotKey)) storage.assertStorageEnabled();

  // Chỉ hỏi đúng các góp ý được ghim trong lần gọi này, không nạp cả danh sách góp ý của sản phẩm.
  const pinnedIds = [
    ...new Set(
      input.pages.flatMap((page) =>
        (page.pins || []).map((pin) => pin.feedbackId)
      )
    ),
  ];
  const known = pinnedIds.length
    ? await all(sql`
        SELECT id FROM feedback
        WHERE deliverable_id = ${d.id} AND id IN ${sql.list(pinnedIds)}`)
    : [];
  const knownIds = new Set(known.map((fb) => fb.id));

  // Nhận mọi ảnh song song và chờ TẤT CẢ xong (kể cả khi có ảnh hỏng) rồi mới quyết định:
  // nếu dừng ngay ở ảnh hỏng đầu tiên thì ảnh khác đang nhận dở sẽ thành file mồ côi trên kho.
  // Lời gọi kho đặt trước lô ghi (lô không chạy lại được lời gọi kho).
  const adopted = [];
  const at = now();
  const settled = await Promise.allSettled(
    input.pages.map(async (page) => {
      const kept = page.id ? existing.get(page.id) : null;
      const shot = kept ? kept.shot : await adoptPageShot(d, page.shotKey);
      if (!kept) adopted.push({ provider: shot.provider, key: shot.key });
      // Ảnh giữ lại của vòng đã khóa thì trang và kích thước lúc chụp cũng giữ nguyên, chỉ ghim được đổi.
      const frozen = kept && locked;
      const late = kept ? kept.late : locked;
      return {
        id: kept ? kept.id : newId(),
        pageUrl: frozen ? kept.pageUrl : page.pageUrl,
        shot,
        docSize: frozen ? kept.docSize : page.docSize,
        pins: (page.pins || [])
          .filter((pin) => knownIds.has(pin.feedbackId))
          .map((pin) => ({ feedback: pin.feedbackId, x: pin.x, y: pin.y })),
        capturedAt: kept ? kept.capturedAt : at,
        ...(late && { late: true }),
      };
    })
  );
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) {
    // Một ảnh hỏng: bỏ luôn các ảnh đã nhận của lần gọi này, bộ ảnh cũ của vòng giữ nguyên.
    await storage.trashQuietly(adopted);
    throw failed.reason;
  }
  const pages = settled.map((result) => result.value);

  // Ảnh của bộ cũ không còn trang nào dùng: vào thùng rác trong cùng lô.
  const stillUsed = new Set(pages.map((page) => page.shot.key));
  const unused = (latest.pages || [])
    .filter((page) => !stillUsed.has(page.shot.key))
    .map((page) => ({ provider: page.shot.provider, key: page.shot.key }));

  let updated;
  try {
    updated = await transact(
      async () => ({
        statements: [
          // Ghi có điều kiện: vòng đổi trạng thái, người khác vừa lưu bộ ảnh (pages_rev đổi), hoặc vừa có vòng mới hơn
          // (bộ ảnh phải gắn vào vòng mới nhất) thì lần này thua. Không dựa vào updated_at vì khách lưu nháp cũng làm nó đổi.
          guard(sql`
            SELECT 1 FROM rounds
            WHERE id = ${latest.id} AND status = ${latest.status} AND pages_rev = ${latest.pagesRev}
              AND number = (SELECT MAX(number) FROM rounds WHERE deliverable_id = ${d.id})`),
          sql`UPDATE rounds SET ${Round.set({ pages, updatedAt: at })}, pages_rev = pages_rev + 1
              WHERE id = ${latest.id} RETURNING *`,
          auditStatement({
            actor,
            action: "round.pages",
            entityType: "round",
            entityId: latest.id,
            orderId: d.order,
            deliverableId: d.id,
            before: { pages: (latest.pages || []).length },
            after: {
              pages: pages.length,
              number: latest.number,
              ...(locked && { locked: true, force: Boolean(input.force) }),
            },
          }),
          storage.trashStatement(unused),
        ],
        done: (results) => Round.fromRow(results[1].rows[0]),
      }),
      // Không chạy lại: ảnh đã nhận gắn với lần đọc này. Thua thì báo 409 để trình duyệt lưu lại.
      { retries: 0 }
    );
  } catch (err) {
    // Xóa ảnh mình vừa nhận để không thành file mồ côi.
    await storage.trashQuietly(adopted);
    throw err;
  }
  if (unused.length > 0) storage.emptyTrashSoon();

  return {
    round: { ...toPublicRound(updated), pages: toPublicPages(updated) },
  };
}
