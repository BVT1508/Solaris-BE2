import env from "../config/env.js";
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
import { can, assertCan } from "../policies/policy.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { randomHex } from "../utils/hash.js";
import { newId } from "../utils/id.js";
import { disconnectGuestsOf } from "../utils/realtime.js";
import { now } from "../utils/time.js";
import {
  orderNotDeliveredGuard,
  syncOrderStatusStatement,
} from "./orderStatusService.js";
import * as storage from "./storageService.js";

/** Mỗi đơn không quá chừng này sản phẩm đang hoạt động; đủ cho bộ ấn phẩm lớn, chặn tạo nhầm hàng loạt. */
const MAX_ACTIVE_PER_ORDER = 20;

/** design: mỗi ảnh một mặt hoặc một trang. document: đúng một PDF, đính file mới là thay file cũ. */
const MAX_FILES_PER_DESIGN = 20;

const DELIVERED = () =>
  new AppError("Đơn đã bàn giao. Mở lại đơn trước khi làm tiếp.", 409);

/** Khóa nhúng: 32 ký tự hex thường (frontend và bridge chỉ nhận đúng dạng này). */
const newSdkKey = () => randomHex(16);

/** Đoạn script team dán vào site bàn giao. bridge.js do frontend phục vụ. */
const embedSnippet = (sdkKey) =>
  `<script src="${env.FRONTEND_URL}/bridge.js" data-key="${sdkKey}" async></script>`;

// ---------- Phần đọc (các gói link chia sẻ, vòng review, góp ý cũng dùng) ----------

/** File đang dùng của sản phẩm (chưa bị gỡ hay thay). */
export const activeFiles = (d) => (d.files || []).filter((f) => !f.removedAt);

/** File này có nằm trong bộ file của một vòng nào của sản phẩm không. */
const inRoundQuery = (deliverableId, fileId) => sql`
  SELECT 1 FROM rounds r, json_each(r.files) f
  WHERE r.deliverable_id = ${deliverableId} AND f.value = ${fileId}`;

/** File này có góp ý nào ghim lên không. */
const hasFeedbackQuery = (deliverableId, fileId) => sql`
  SELECT 1 FROM feedback
  WHERE deliverable_id = ${deliverableId} AND target_file_id = ${fileId}`;

/**
 * File phải giữ lại trên kho dù đã gỡ hay thay: đã gửi cho khách trong một vòng (để đối chiếu các bản),
 * hoặc đã có góp ý ghim lên (để xem lại góp ý cũ trên đúng bản cũ).
 */
export async function isRetained(deliverableId, fileId) {
  const [inRound, hasFeedback] = await readAll([
    sql`${inRoundQuery(deliverableId, fileId)} LIMIT 1`,
    sql`${hasFeedbackQuery(deliverableId, fileId)} LIMIT 1`,
  ]);
  return inRound.length > 0 || hasFeedback.length > 0;
}

/**
 * Guard cho lô sắp XÓA HẲN một file: khẳng định lại file vẫn không nằm trong vòng nào và không có góp ý nào ghim lên.
 * Giữa lúc `isRetained` trả false và lúc lô chạy, có thể vừa có vòng mới chụp file này hoặc khách vừa ghim lên nó:
 * khi đó guard sai, `transact` chạy lại và lần sau file được giữ. Không đặt nhãn.
 */
export const notRetainedGuards = (deliverableId, fileId) => [
  guardNot(inRoundQuery(deliverableId, fileId)),
  guardNot(hasFeedbackQuery(deliverableId, fileId)),
];

/** url do kho của file đó sinh (có chữ ký). */
export const toPublicFile = (file) => ({
  id: file.id,
  url: storage.readUrl(file),
  // Ảnh nhỏ cho ô xem trước. null thì dùng url.
  thumbUrl: storage.thumbUrl(file),
  // PDF trên Cloudinary: ảnh từng trang. null thì vẽ từ url.
  pageUrls: storage.pageUrls(file),
  contentType: file.contentType,
  bytes: file.bytes,
  width: file.width || null,
  height: file.height || null,
  pages: file.pages || null,
  originalName: file.originalName || null,
  // id của file mà file này thay thế; dùng để ghép bản trước với bản sau khi so sánh.
  replaces: file.replaces || null,
  createdAt: file.createdAt,
});

/** Ảnh chụp trang của một vòng (sản phẩm web), kèm địa chỉ ảnh có chữ ký và vị trí các ghim trên ảnh. */
export const toPublicPages = (round) =>
  (round.pages || []).map((page) => ({
    id: page.id,
    pageUrl: page.pageUrl,
    url: storage.readUrl(page.shot),
    thumbUrl: storage.thumbUrl(page.shot),
    width: page.shot.width || null,
    height: page.shot.height || null,
    docSize: page.docSize?.w ? page.docSize : null,
    pins: (page.pins || []).map((pin) => ({
      feedbackId: pin.feedback,
      x: pin.x,
      y: pin.y,
    })),
    capturedAt: page.capturedAt,
    // true: ảnh chụp sau khi khách đã gửi góp ý của vòng, có thể đã lẫn phần team sửa.
    late: Boolean(page.late),
  }));

const sameIds = (a, b) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Phiên bản theo vòng: mỗi vòng là đúng bộ file khách được xem trong vòng đó. `rounds` theo số vòng TĂNG dần
 * (vòng mới nhất nằm cuối; ngược với danh sách GET /deliverables/:id/rounds là mới nhất trước).
 */
function buildVersions(d, rounds) {
  const byId = new Map((d.files || []).map((f) => [f.id, f]));
  return rounds.map((round, index) => ({
    round: round.number,
    status: round.status,
    note: round.note || null,
    openedAt: round.openedAt,
    current: index === rounds.length - 1,
    url: round.url || null,
    files: (round.files || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(toPublicFile),
    // Chỉ web: bộ ảnh chụp trang của vòng. Loại khác luôn rỗng.
    pages: toPublicPages(round),
  }));
}

/** Các vòng của một sản phẩm theo số tăng dần. */
export const loadRounds = async (deliverableId) =>
  (
    await all(
      sql`SELECT * FROM rounds WHERE deliverable_id = ${deliverableId} ORDER BY number`
    )
  ).map(Round.fromRow);

/**
 * showKey: quản trị viên và leader của đơn mới thấy sdkKey và đoạn nhúng.
 * rounds: các vòng của sản phẩm theo số tăng dần, truyền sẵn khi đã có; không truyền thì tự nạp.
 */
export async function toPublicDeliverable(d, { showKey, rounds }) {
  const allRounds = rounds || (await loadRounds(d.id));
  const latest = allRounds[allRounds.length - 1];
  return {
    id: d.id,
    orderId: d.order,
    type: d.type,
    name: d.name,
    url: d.url || null,
    // files: bản team đang làm (bản sửa tải lên nằm ở đây, khách chưa thấy cho tới khi gửi xem lại).
    // previousFiles: bản đã gỡ hoặc đã thay nhưng còn giữ. versions: bộ file khách được xem ở từng vòng.
    files: activeFiles(d).map(toPublicFile),
    previousFiles: (d.files || []).filter((f) => f.removedAt).map(toPublicFile),
    versions: buildVersions(d, allRounds),
    // Bản đang làm khác bản khách đang xem: nhắc team bấm "Gửi khách xem lại" (hoặc cập nhật bản đang gửi).
    hasUnsentChanges: Boolean(
      latest &&
      latest.status !== "approved" &&
      !sameIds(
        latest.files || [],
        activeFiles(d).map((f) => f.id)
      )
    ),
    bridgeSeenAt: d.bridgeSeenAt || null,
    status: d.status,
    archivedAt: d.archivedAt || null,
    createdBy: d.createdBy || null,
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(showKey &&
      d.type === "web" && {
        sdkKey: d.sdkKey,
        embedSnippet: embedSnippet(d.sdkKey),
      }),
  };
}

const toPublic = toPublicDeliverable;

const canSeeKey = (actor, orderId) =>
  can(actor, "deliverable.update", { orderId });

async function findOrder(actor, orderId) {
  const order = await first(
    sql`SELECT id, status FROM orders WHERE id = ${orderId} AND org_id = ${actor.orgId}`
  );
  if (!order) throw new AppError("Không tìm thấy đơn hàng.", 404);
  return order;
}

/** Sản phẩm của tổ chức người gọi (đủ mọi cột, kể cả sdkKey: nơi gọi tự quyết định có trả ra không). */
export async function findDeliverable(actor, id) {
  const d = Deliverable.fromRow(
    await first(
      sql`SELECT * FROM deliverables WHERE id = ${id} AND org_id = ${actor.orgId}`
    )
  );
  if (!d) throw new AppError("Không tìm thấy sản phẩm bàn giao.", 404);
  return d;
}

export async function listDeliverables(actor, orderId, query = {}) {
  assertCan(actor, "deliverable.read", { orderId });
  await findOrder(actor, orderId);
  const where = [sql`order_id = ${orderId}`];
  if (query.status) where.push(sql`status = ${query.status}`);
  // Sản phẩm và vòng của cả đơn trong một lượt đi về, rồi chia vòng theo sản phẩm.
  const [rows, roundRows] = await readAll([
    sql`SELECT * FROM deliverables WHERE ${sql.and(where)} ORDER BY id DESC`,
    sql`SELECT * FROM rounds WHERE order_id = ${orderId} ORDER BY number`,
  ]);
  const allRounds = roundRows.map(Round.fromRow);
  const showKey = canSeeKey(actor, orderId);
  return Promise.all(
    rows.map(Deliverable.fromRow).map((d) =>
      toPublic(d, {
        showKey,
        rounds: allRounds.filter((round) => round.deliverable === d.id),
      })
    )
  );
}

export async function getDeliverable(actor, id) {
  const d = await findDeliverable(actor, id);
  assertCan(actor, "deliverable.read", { orderId: d.order });
  return toPublic(d, { showKey: canSeeKey(actor, d.order) });
}

// ---------- Ghi ----------

const versionGuard = (id, version) =>
  guard(
    sql`SELECT 1 FROM deliverables WHERE id = ${id} AND version = ${version}`,
    "stale"
  );

const GUARD_ERRORS = { stale: STALE };

/** Sản phẩm nhận file: không phải web, chưa lưu trữ. */
function assertAcceptsFiles(d) {
  if (d.type === "web") {
    throw new AppError(
      "Sản phẩm web không nhận file, chỉ có địa chỉ site.",
      400
    );
  }
  if (d.status === "archived") {
    throw new AppError("Sản phẩm đã lưu trữ, khôi phục trước khi sửa.", 400);
  }
}

/** design nhận ảnh, document nhận PDF. */
function assertKindMatches(d, rule) {
  const wanted = d.type === "design" ? "image" : "pdf";
  if (rule.kind !== wanted) {
    throw new AppError(
      d.type === "design"
        ? "Sản phẩm design chỉ nhận ảnh PNG, JPG, WebP."
        : "Sản phẩm document chỉ nhận PDF.",
      400
    );
  }
}

/** Quản trị viên hoặc leader của đơn. web sinh sdkKey ngay; design, document nhận file sau. */
export async function createDeliverable(actor, orderId, input) {
  assertCan(actor, "deliverable.create", { orderId });
  return transact(async () => {
    const order = await findOrder(actor, orderId);
    if (order.status === "delivered") {
      throw new AppError(
        "Đơn đã bàn giao. Mở lại đơn trước khi thêm sản phẩm.",
        409
      );
    }
    const { n: activeCount } = await first(sql`
      SELECT count(*) AS n FROM deliverables WHERE order_id = ${orderId} AND status = 'active'`);
    if (activeCount >= MAX_ACTIVE_PER_ORDER) {
      throw new AppError(
        `Mỗi đơn tối đa ${MAX_ACTIVE_PER_ORDER} sản phẩm đang hoạt động.`,
        400
      );
    }

    const at = now();
    const created = {
      id: newId(),
      org: actor.orgId,
      order: orderId,
      type: input.type,
      name: input.name,
      url: input.url,
      ...(input.type === "web" && { sdkKey: newSdkKey() }),
      files: [],
      status: "active",
      createdBy: actor.memberId,
      feedbackSeq: 0,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    return {
      statements: [
        orderNotDeliveredGuard(orderId),
        guard(sql`
          SELECT 1 WHERE (
            SELECT count(*) FROM deliverables WHERE order_id = ${orderId} AND status = 'active'
          ) < ${MAX_ACTIVE_PER_ORDER}`),
        Deliverable.insert(created),
        auditStatement({
          actor,
          action: "deliverable.create",
          entityType: "deliverable",
          entityId: created.id,
          orderId,
          deliverableId: created.id,
          after: { order: orderId, type: created.type, name: created.name },
        }),
        // Đơn đang "khách đã duyệt" mà có thêm sản phẩm chưa ai duyệt thì không còn approved nữa.
        syncOrderStatusStatement(orderId),
      ],
      // Người tạo luôn là quản trị viên hoặc leader nên thấy khóa. Sản phẩm mới chưa có vòng nào.
      done: () => toPublic(created, { showKey: true, rounds: [] }),
    };
  });
}

export async function updateDeliverable(actor, id, input) {
  return transact(
    async () => {
      const d = await findDeliverable(actor, id);
      assertCan(actor, "deliverable.update", { orderId: d.order });
      if (d.version !== input.version) throw STALE();
      if (d.status === "archived") {
        throw new AppError(
          "Sản phẩm đã lưu trữ, khôi phục trước khi sửa.",
          400
        );
      }
      if (input.url !== undefined && d.type !== "web") {
        throw new AppError("Chỉ sản phẩm web mới có địa chỉ.", 400);
      }

      const { version, ...fields } = input;
      const at = now();
      return {
        statements: [
          versionGuard(d.id, version),
          sql`UPDATE deliverables SET ${Deliverable.set({ ...fields, updatedAt: at })}, version = version + 1
              WHERE id = ${d.id}`,
          auditStatement({
            actor,
            action: "deliverable.update",
            entityType: "deliverable",
            entityId: d.id,
            orderId: d.order,
            deliverableId: d.id,
            before: pick(d, Object.keys(fields)),
            after: fields,
          }),
        ],
        done: () =>
          toPublic(
            { ...d, ...fields, version: d.version + 1, updatedAt: at },
            { showKey: true }
          ),
      };
    },
    { errors: GUARD_ERRORS }
  );
}

/**
 * Chỉ admin. Link chia sẻ của sản phẩm lưu trữ chết ngay (kiểm lúc khách mở link), khôi phục thì sống lại.
 * Vòng đang mở của sản phẩm lưu trữ không còn tính vào trạng thái đơn.
 */
export async function archiveDeliverable(actor, id, input) {
  assertCan(actor, "deliverable.archive");
  const result = await changeStatus(actor, id, input, {
    action: "deliverable.archive",
    from: "active",
    to: "archived",
    conflict: "Sản phẩm đã lưu trữ rồi.",
  });
  // Link của sản phẩm đã lưu trữ ngừng chia sẻ: khách đang nghe trực tiếp bị ngắt.
  disconnectGuestsOf(id);
  return result;
}

export async function restoreDeliverable(actor, id, input) {
  assertCan(actor, "deliverable.archive");
  return changeStatus(actor, id, input, {
    action: "deliverable.restore",
    from: "archived",
    to: "active",
    conflict: "Sản phẩm không ở trạng thái lưu trữ.",
  });
}

/** Lưu trữ và khôi phục: cùng một khuôn. Đơn đã bàn giao là đã đóng nên không đổi được (link của khách sẽ chết hoặc sống lại sai lúc). */
async function changeStatus(actor, id, input, { action, from, to, conflict }) {
  return transact(
    async () => {
      const d = await findDeliverable(actor, id);
      if (d.version !== input.version) throw STALE();
      if (d.status !== from) throw new AppError(conflict, 409);
      const order = await first(
        sql`SELECT status FROM orders WHERE id = ${d.order}`
      );
      if (order?.status === "delivered") throw DELIVERED();

      const at = now();
      const archivedAt = to === "archived" ? at : null;
      return {
        statements: [
          versionGuard(d.id, input.version),
          orderNotDeliveredGuard(d.order),
          sql`UPDATE deliverables SET status = ${to}, archived_at = ${archivedAt}, version = version + 1, updated_at = ${at}
              WHERE id = ${d.id}`,
          auditStatement({
            actor,
            action,
            entityType: "deliverable",
            entityId: d.id,
            orderId: d.order,
            deliverableId: d.id,
            before: { status: from },
            after: { status: to },
          }),
          syncOrderStatusStatement(d.order),
        ],
        done: () =>
          toPublic(
            {
              ...d,
              status: to,
              archivedAt,
              version: d.version + 1,
              updatedAt: at,
            },
            { showKey: true }
          ),
      };
    },
    { errors: GUARD_ERRORS }
  );
}

/** Chỉ admin, khi khóa bị lộ. Khóa cũ chết ngay; site phải dán lại đoạn nhúng. Không ghi khóa vào nhật ký. */
export async function rotateSdkKey(actor, id, input) {
  assertCan(actor, "deliverable.rotateKey");
  return transact(
    async () => {
      const d = await findDeliverable(actor, id);
      if (d.version !== input.version) throw STALE();
      if (d.type !== "web") {
        throw new AppError("Chỉ sản phẩm web mới có khóa nhúng.", 400);
      }
      const at = now();
      const sdkKey = newSdkKey();
      return {
        statements: [
          versionGuard(d.id, input.version),
          sql`UPDATE deliverables SET sdk_key = ${sdkKey}, version = version + 1, updated_at = ${at}
              WHERE id = ${d.id}`,
          auditStatement({
            actor,
            action: "deliverable.rotateKey",
            entityType: "deliverable",
            entityId: d.id,
            orderId: d.order,
            deliverableId: d.id,
          }),
        ],
        done: () =>
          toPublic(
            { ...d, sdkKey, version: d.version + 1, updatedAt: at },
            { showKey: true }
          ),
      };
    },
    { errors: GUARD_ERRORS }
  );
}

// ---------- File (design, document) ----------
// Quyền: ai làm việc trong đơn (nhân viên, leader, quản trị viên; policy deliverable.files). Nhân viên thay file sau khi sửa,
// khách chưa thấy gì cho tới khi leader "Gửi khách xem lại": mỗi vòng giữ bộ file đã chụp lúc gửi.
// Ba bước: (1) xin thông tin upload đã ký, (2) trình duyệt đẩy thẳng lên kho, (3) đính file vào sản phẩm.

/** Bước 1. Không ghi gì vào database; file đẩy lên mà không đính sẽ bị dọn sau. */
export async function createUploadUrl(actor, id, input) {
  const d = await findDeliverable(actor, id);
  assertCan(actor, "deliverable.files", { orderId: d.order });
  assertAcceptsFiles(d);

  const rule = storage.ruleFor(input.contentType);
  assertKindMatches(d, rule);
  if (input.bytes > rule.maxBytes) {
    throw new AppError(
      `File tối đa ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`,
      400
    );
  }
  if (d.type === "design" && activeFiles(d).length >= MAX_FILES_PER_DESIGN) {
    throw new AppError(
      `Mỗi sản phẩm design tối đa ${MAX_FILES_PER_DESIGN} ảnh.`,
      400
    );
  }

  // Mọi luật nghiệp vụ đã qua; chỉ bước ký mới cần kho.
  storage.assertStorageEnabled();
  const key = storage.pendingKey(d.id, rule.ext);
  return storage.createUpload(key, rule, input.contentType, input.bytes);
}

/** File nào bị file mới thay: document luôn thay file đang dùng; design thay đúng ảnh được chỉ định (replacesFileId). */
function replacedBy(d, input) {
  const active = activeFiles(d);
  let replaced = [];
  if (d.type === "document") replaced = active;
  else if (input.replacesFileId) {
    const old = active.find((f) => f.id === input.replacesFileId);
    if (!old) {
      throw new AppError("Ảnh được thay không còn trong bản đang dùng.", 400);
    }
    replaced = [old];
  }
  if (
    d.type === "design" &&
    replaced.length === 0 &&
    active.length >= MAX_FILES_PER_DESIGN
  ) {
    throw new AppError(
      `Mỗi sản phẩm design tối đa ${MAX_FILES_PER_DESIGN} ảnh.`,
      400
    );
  }
  return replaced;
}

/** Các bước kiểm của bước 3 chỉ dựa vào sản phẩm (chạy lại được mỗi lần `plan` đọc lại sản phẩm). */
function assertCanAttach(actor, d, input) {
  assertCan(actor, "deliverable.files", { orderId: d.order });
  if (d.version !== input.version) throw STALE();
  assertAcceptsFiles(d);
  storage.assertStorageEnabled();
  if (!storage.pendingKeyPattern(d.id).test(input.key)) {
    throw new AppError("Key không thuộc sản phẩm này.", 400);
  }
}

/**
 * Bước 3. Kiểm file có thật trên kho, đúng loại, đúng cỡ, lấy số đo rồi chuyển sang key chính thức.
 * document: file mới thay file cũ. File bị thay mà chưa từng gửi khách và không có góp ý thì vào thùng rác của kho.
 *
 * Lời gọi kho chạy TRƯỚC `transact` (hàm plan có thể chạy lại, kho thì không gọi lại được vì file tạm đã chuyển đi).
 */
export async function attachFile(actor, id, input) {
  const before = await findDeliverable(actor, id);
  assertCanAttach(actor, before, input);

  const provider = storage.activeProvider();
  const pending = { provider, key: input.key };
  const info = await storage.statPending(input.key);
  if (!info) {
    throw new AppError("Chưa thấy file trên kho, hãy đẩy file trước.", 400);
  }
  const rule = storage.ruleFor(info.contentType);
  if (!rule) {
    await storage.trashQuietly([pending]);
    throw new AppError("Loại file trên kho không được nhận.", 400);
  }
  assertKindMatches(before, rule);
  if (info.bytes > rule.maxBytes) {
    await storage.trashQuietly([pending]);
    throw new AppError(
      `File tối đa ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`,
      400
    );
  }
  replacedBy(before, input);

  const measured = await storage.measurePending(input.key, rule, info);
  const key = storage.finalKey(before.order, before.id, rule.ext);
  await storage.promote(input.key, key);
  const promoted = { provider, key };

  try {
    const result = await transact(
      async () => {
        const d = await findDeliverable(actor, id);
        assertCanAttach(actor, d, input);
        assertKindMatches(d, rule);
        const replaced = replacedBy(d, input);

        const at = now();
        const file = {
          id: newId(),
          provider,
          key,
          contentType: info.contentType,
          bytes: info.bytes,
          ...measured,
          originalName: input.originalName,
          createdAt: at,
        };
        // File mới vào đúng vị trí của file nó thay, để thứ tự ảnh không đổi.
        // File bị thay: đã gửi cho khách hoặc đã có góp ý thì giữ lại (removedAt), chưa thì xóa hẳn.
        const replacedIds = new Set(replaced.map((f) => f.id));
        const discarded = [];
        const next = [];
        let placed = false;
        for (const existing of d.files || []) {
          if (!replacedIds.has(existing.id)) {
            next.push(existing);
            continue;
          }
          if (await isRetained(d.id, existing.id)) {
            next.push({ ...existing, removedAt: at });
            // Bản bị thay còn giữ: bản mới nối thẳng vào nó.
            if (!file.replaces) file.replaces = existing.id;
          } else {
            discarded.push(existing);
            // Bản bị thay chưa từng gửi cho khách nên xóa hẳn: bản mới nối vào bản trước đó nữa,
            // để chuỗi "bản sau thay bản trước" không đứt.
            if (!file.replaces && existing.replaces) {
              file.replaces = existing.replaces;
            }
          }
          if (!placed) {
            next.push(file);
            placed = true;
          }
        }
        if (!placed) next.push(file);

        return {
          statements: [
            versionGuard(d.id, input.version),
            ...discarded.flatMap((f) => notRetainedGuards(d.id, f.id)),
            sql`UPDATE deliverables SET files = ${JSON.stringify(next)}, version = version + 1, updated_at = ${at}
                WHERE id = ${d.id}`,
            auditStatement({
              actor,
              action: "deliverable.fileAdd",
              entityType: "deliverable",
              entityId: d.id,
              orderId: d.order,
              deliverableId: d.id,
              after: {
                provider,
                key,
                contentType: info.contentType,
                bytes: info.bytes,
                ...measured,
                originalName: input.originalName || null,
                replaced: replaced.map((f) => f.key),
                replacedNames: replaced.map((f) => f.originalName || null),
              },
            }),
            storage.trashStatement(discarded),
          ],
          done: () =>
            toPublic(
              { ...d, files: next, version: d.version + 1, updatedAt: at },
              { showKey: true }
            ),
        };
      },
      { errors: GUARD_ERRORS }
    );
    storage.emptyTrashSoon();
    return result;
  } catch (err) {
    // Hỏng sau khi đã chuyển sang key chính thức: bỏ bản đó để không mồ côi trên kho.
    await storage.trashQuietly([promoted]);
    throw err;
  }
}

/** Gỡ một file. File đã gửi cho khách hoặc đã có góp ý thì chỉ đánh dấu đã gỡ và giữ trên kho; chưa thì vào thùng rác. */
export async function removeFile(actor, id, fileId, input) {
  const result = await transact(
    async () => {
      const d = await findDeliverable(actor, id);
      assertCan(actor, "deliverable.files", { orderId: d.order });
      if (d.version !== input.version) throw STALE();
      if (d.status === "archived") {
        throw new AppError(
          "Sản phẩm đã lưu trữ, khôi phục trước khi sửa.",
          400
        );
      }
      const file = activeFiles(d).find((f) => f.id === fileId);
      if (!file) throw new AppError("Không tìm thấy file.", 404);

      const keep = await isRetained(d.id, file.id);
      const at = now();
      const next = keep
        ? d.files.map((f) => (f.id === file.id ? { ...f, removedAt: at } : f))
        : d.files.filter((f) => f.id !== file.id);
      return {
        statements: [
          versionGuard(d.id, input.version),
          ...(keep ? [] : notRetainedGuards(d.id, file.id)),
          sql`UPDATE deliverables SET files = ${JSON.stringify(next)}, version = version + 1, updated_at = ${at}
              WHERE id = ${d.id}`,
          auditStatement({
            actor,
            action: "deliverable.fileRemove",
            entityType: "deliverable",
            entityId: d.id,
            orderId: d.order,
            deliverableId: d.id,
            before: {
              key: file.key,
              originalName: file.originalName,
              kept: keep,
            },
          }),
          storage.trashStatement(keep ? [] : [file]),
        ],
        done: () =>
          toPublic(
            { ...d, files: next, version: d.version + 1, updatedAt: at },
            { showKey: true }
          ),
      };
    },
    { errors: GUARD_ERRORS }
  );
  storage.emptyTrashSoon();
  return result;
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}
