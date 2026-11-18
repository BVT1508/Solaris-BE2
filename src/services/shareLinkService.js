import env from "../config/env.js";
import {
  all,
  first,
  guard,
  guardNot,
  readAll,
  run,
  sql,
  transact,
} from "../db/d1.js";
import { Deliverable, Round, ShareLink } from "../models/index.js";
import { can, assertCan } from "../policies/policy.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { randomToken } from "../utils/hash.js";
import { newId } from "../utils/id.js";
import logger from "../utils/logger.js";
import { disconnectLink } from "../utils/realtime.js";
import { now } from "../utils/time.js";
import {
  activeFiles,
  findDeliverable,
  toPublicDeliverable,
} from "./deliverableService.js";
import {
  orderNotDeliveredGuard,
  orderStatusOf,
  syncOrderStatusStatement,
} from "./orderStatusService.js";
import { snapshotOf, toPublicRound } from "./roundService.js";

/** Số link còn sống (đang chia sẻ hoặc tạm dừng) tối đa của một sản phẩm. */
const MAX_LIVE_LINKS = 10;

/** 24 byte ngẫu nhiên, 32 ký tự base64url: không đoán được, gọn trong đường dẫn. Frontend chỉ nhận đúng dạng này. */
const newToken = () => randomToken(24);

/** Link gửi cho khách, mở màn review của frontend. */
const linkUrl = (token) => `${env.FRONTEND_URL}/r/${token}`;

/** showToken: quản trị viên và leader của đơn mới thấy token và url. */
const toPublic = (link, { showToken }) => ({
  id: link.id,
  orderId: link.order,
  deliverableId: link.deliverable,
  contactName: link.contactName,
  contactId: link.contactId || null,
  note: link.note || null,
  status: link.status,
  revokedAt: link.revokedAt || null,
  lastOpenedAt: link.lastOpenedAt || null,
  openCount: link.openCount || 0,
  createdBy: link.createdBy || null,
  version: link.version,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
  ...(showToken && { token: link.token, url: linkUrl(link.token) }),
});

async function findLink(actor, id) {
  const link = ShareLink.fromRow(
    await first(
      sql`SELECT * FROM share_links WHERE id = ${id} AND org_id = ${actor.orgId}`
    )
  );
  if (!link) throw new AppError("Không tìm thấy link chia sẻ.", 404);
  return link;
}

const latestRoundQuery = (deliverableId) => sql`
  SELECT * FROM rounds WHERE deliverable_id = ${deliverableId}
  ORDER BY number DESC LIMIT 1`;

const liveLinksQuery = (deliverableId) => sql`
  SELECT count(*) AS n FROM share_links
  WHERE deliverable_id = ${deliverableId} AND status IN ('active', 'paused')`;

/** Tên người nhận: lấy từ người liên hệ của khách nếu chọn contactId, không thì theo tên gõ vào. */
async function resolveContact(deliverable, input) {
  if (!input.contactId) return { contactName: input.contactName };
  const client = await first(sql`
    SELECT c.contacts FROM orders o JOIN clients c ON c.id = o.client_id
    WHERE o.id = ${deliverable.order}`);
  const contact = JSON.parse(client?.contacts || "[]").find(
    (c) => c._id === input.contactId
  );
  if (!contact) {
    throw new AppError(
      "Người liên hệ không thuộc khách hàng của đơn này.",
      400
    );
  }
  return {
    contactId: contact._id,
    contactName: input.contactName || contact.name,
  };
}

// ---------- Tạo ----------

/**
 * Quản trị viên hoặc leader của đơn. Link đầu tiên của sản phẩm mở vòng 1, và đơn chuyển sang awaiting_feedback.
 * Các link sau dùng chung vòng hiện tại.
 */
export async function createShareLink(actor, deliverableId, input) {
  const plan = async () => {
    const d = await findDeliverable(actor, deliverableId);
    assertCan(actor, "shareLink.manage", { orderId: d.order });
    if (d.status === "archived") {
      throw new AppError(
        "Sản phẩm đã lưu trữ, khôi phục trước khi chia sẻ.",
        400
      );
    }
    const [[order], [live], [latest]] = await readAll([
      sql`SELECT status FROM orders WHERE id = ${d.order}`,
      liveLinksQuery(d.id),
      latestRoundQuery(d.id),
    ]);
    if (order?.status === "delivered") {
      throw new AppError(
        "Đơn đã bàn giao. Mở lại đơn trước khi làm tiếp.",
        409
      );
    }
    if (d.type !== "web" && activeFiles(d).length === 0) {
      throw new AppError("Sản phẩm chưa có file để khách xem.", 400);
    }
    if (live.n >= MAX_LIVE_LINKS) {
      throw new AppError(
        `Mỗi sản phẩm tối đa ${MAX_LIVE_LINKS} link đang dùng. Thu hồi bớt link cũ.`,
        400
      );
    }

    const contact = await resolveContact(d, input);
    const at = now();
    const link = {
      id: newId(),
      org: actor.orgId,
      order: d.order,
      deliverable: d.id,
      token: newToken(),
      ...contact,
      note: input.note,
      status: "active",
      openCount: 0,
      createdBy: actor.memberId,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };

    let round = Round.fromRow(latest);
    const openedRound = !round;
    const statements = [
      // Sản phẩm chưa bị lưu trữ giữa lúc đọc và lúc ghi (luôn kiểm, kể cả khi link này không mở vòng).
      guard(
        sql`SELECT 1 FROM deliverables WHERE id = ${d.id} AND status = 'active'`
      ),
      orderNotDeliveredGuard(d.order),
      guard(sql`SELECT 1 WHERE (${liveLinksQuery(d.id)}) < ${MAX_LIVE_LINKS}`),
    ];
    if (openedRound) {
      statements.push(
        // Link này mở vòng 1 thì bộ file chụp vào vòng phải đúng là bộ đang có
        // (ai đó gỡ hay thay file cùng lúc làm version của sản phẩm đổi).
        guard(
          sql`SELECT 1 FROM deliverables WHERE id = ${d.id} AND version = ${d.version}`
        ),
        // Hai người tạo link đầu cùng lúc: người sau thấy đã có vòng, `transact` chạy lại `plan`,
        // lần đó chỉ tạo link và dùng chung vòng vừa mở.
        guardNot(sql`SELECT 1 FROM rounds WHERE deliverable_id = ${d.id}`)
      );
    }
    statements.push(ShareLink.insert(link));
    if (openedRound) {
      round = {
        id: newId(),
        org: actor.orgId,
        order: d.order,
        deliverable: d.id,
        number: 1,
        status: "open",
        openedBy: actor.memberId,
        openedAt: at,
        ...snapshotOf(d),
        createdAt: at,
        updatedAt: at,
      };
      statements.push(Round.insert(round));
    }
    const syncAt = statements.push(syncOrderStatusStatement(d.order)) - 1;
    statements.push(
      auditStatement({
        actor,
        action: "shareLink.create",
        entityType: "shareLink",
        entityId: link.id,
        orderId: d.order,
        deliverableId: d.id,
        after: {
          deliverable: d.id,
          contactName: link.contactName,
          openedRound: openedRound ? round.number : null,
        },
      })
    );
    return {
      statements,
      done: (results) => ({
        shareLink: toPublic(link, { showToken: true }),
        round: toPublicRound(round),
        orderStatus: orderStatusOf(results[syncAt]),
      }),
    };
  };

  return transact(plan);
}

// ---------- Đọc (team) ----------

export async function listShareLinks(actor, deliverableId) {
  const d = await findDeliverable(actor, deliverableId);
  assertCan(actor, "deliverable.read", { orderId: d.order });
  const rows = await all(
    sql`SELECT * FROM share_links WHERE deliverable_id = ${d.id} ORDER BY id DESC`
  );
  const showToken = can(actor, "shareLink.manage", { orderId: d.order });
  return rows.map((row) => toPublic(ShareLink.fromRow(row), { showToken }));
}

/** Các vòng của sản phẩm, MỚI NHẤT TRƯỚC (ngược với deliverable.versions là mới nhất sau). */
export async function listRounds(actor, deliverableId) {
  const d = await findDeliverable(actor, deliverableId);
  assertCan(actor, "deliverable.read", { orderId: d.order });
  const rows = await all(
    sql`SELECT * FROM rounds WHERE deliverable_id = ${d.id} ORDER BY number DESC`
  );
  return rows.map((row) => toPublicRound(Round.fromRow(row)));
}

// ---------- Sửa ----------

const versionGuard = (id, version) =>
  guard(
    sql`SELECT 1 FROM share_links WHERE id = ${id} AND version = ${version}`,
    "stale"
  );

export async function updateShareLink(actor, id, input) {
  return transact(
    async () => {
      const link = await findLink(actor, id);
      assertCan(actor, "shareLink.manage", { orderId: link.order });
      if (link.version !== input.version) throw STALE();
      if (link.status === "revoked") {
        throw new AppError("Link đã thu hồi, không sửa được.", 400);
      }
      const { version, ...fields } = input;
      return {
        statements: [
          versionGuard(id, version),
          sql`UPDATE share_links SET ${ShareLink.set({ ...fields, updatedAt: now() })}, version = version + 1
              WHERE id = ${id} RETURNING *`,
          auditStatement({
            actor,
            action: "shareLink.update",
            entityType: "shareLink",
            entityId: id,
            orderId: link.order,
            deliverableId: link.deliverable,
            before: pick(link, Object.keys(fields)),
            after: fields,
          }),
        ],
        done: (results) =>
          toPublic(ShareLink.fromRow(results[1].rows[0]), { showToken: true }),
      };
    },
    { errors: { stale: STALE } }
  );
}

/** Đổi trạng thái có kiểm trạng thái hiện tại. from: các trạng thái được phép đi từ đó. */
async function changeStatus(actor, id, input, { action, from, to, conflict }) {
  return transact(
    async () => {
      const link = await findLink(actor, id);
      assertCan(actor, "shareLink.manage", { orderId: link.order });
      if (link.version !== input.version) throw STALE();
      if (!from.includes(link.status)) throw new AppError(conflict, 409);

      const at = now();
      const set = { status: to, updatedAt: at };
      if (to === "revoked") set.revokedAt = at;
      return {
        statements: [
          versionGuard(id, input.version),
          sql`UPDATE share_links SET ${ShareLink.set(set)}, version = version + 1
              WHERE id = ${id} RETURNING *`,
          auditStatement({
            actor,
            action,
            entityType: "shareLink",
            entityId: id,
            orderId: link.order,
            deliverableId: link.deliverable,
            before: { status: link.status },
            after: { status: to },
          }),
        ],
        done: (results) => ({
          shareLink: toPublic(ShareLink.fromRow(results[1].rows[0]), {
            showToken: true,
          }),
          deliverableId: link.deliverable,
        }),
      };
    },
    { errors: { stale: STALE } }
  );
}

/** Tạm dừng: khách vẫn mở xem được nhưng không gửi góp ý được. */
export const pauseShareLink = async (actor, id, input) =>
  (
    await changeStatus(actor, id, input, {
      action: "shareLink.pause",
      from: ["active"],
      to: "paused",
      conflict: "Link không ở trạng thái đang chia sẻ.",
    })
  ).shareLink;

export const resumeShareLink = async (actor, id, input) =>
  (
    await changeStatus(actor, id, input, {
      action: "shareLink.resume",
      from: ["paused"],
      to: "active",
      conflict: "Link không ở trạng thái tạm dừng.",
    })
  ).shareLink;

/**
 * Thu hồi: link chết ngay và không mở lại được; muốn chia sẻ tiếp thì tạo link mới.
 * Trả kèm remaining: còn bao nhiêu link dùng được và bao nhiêu nháp khách chưa gửi trên sản phẩm.
 * Thu hồi link cuối cùng khi khách còn nháp thì không ai gửi được các nháp đó nữa, nên giao diện cần báo cho team.
 */
export async function revokeShareLink(actor, id, input) {
  const { shareLink, deliverableId } = await changeStatus(actor, id, input, {
    action: "shareLink.revoke",
    from: ["active", "paused"],
    to: "revoked",
    conflict: "Link đã thu hồi rồi.",
  });
  // Khách đang mở link này và nghe trực tiếp: ngắt, vì link đã chết.
  disconnectLink(id);
  const [[live], [drafts]] = await readAll([
    liveLinksQuery(deliverableId),
    sql`SELECT count(*) AS n FROM feedback
        WHERE deliverable_id = ${deliverableId} AND status = 'draft'`,
  ]);
  return { shareLink, remaining: { liveLinks: live.n, drafts: drafts.n } };
}

// ---------- Đọc (khách, không đăng nhập) ----------

/**
 * Nạp link theo token cùng sản phẩm, vòng hiện tại và đơn; dùng cho mọi đường của khách (một lượt đi về tới D1).
 * Link thu hồi và link không có báo chung một lời để không dò được token nào từng tồn tại.
 * Sản phẩm lưu trữ thì link chết (410) tới khi khôi phục.
 * Trả { link, deliverable, round, order, orderStatus }: round là vòng mới nhất (null nếu chưa có),
 * order chỉ gồm { id, status, title, type, client, clientName }.
 */
export async function loadLinkContext(token) {
  const [[linkRow], [deliverableRow], [roundRow], [order]] = await readAll([
    sql`SELECT * FROM share_links WHERE token = ${token}`,
    sql`SELECT d.* FROM deliverables d JOIN share_links l ON l.deliverable_id = d.id
        WHERE l.token = ${token}`,
    sql`SELECT r.* FROM rounds r JOIN share_links l ON l.deliverable_id = r.deliverable_id
        WHERE l.token = ${token} ORDER BY r.number DESC LIMIT 1`,
    // Tên khách lấy luôn ở đây: màn khách mở link cần, đỡ một lượt đi về riêng.
    sql`SELECT o.id, o.status, o.title, o.type, o.client_id AS client, c.name AS clientName
        FROM orders o JOIN share_links l ON l.order_id = o.id
        LEFT JOIN clients c ON c.id = o.client_id WHERE l.token = ${token}`,
  ]);
  const link = ShareLink.fromRow(linkRow);
  if (!link || link.status === "revoked") {
    throw new AppError("Link không tồn tại hoặc đã bị thu hồi.", 404);
  }
  const deliverable = Deliverable.fromRow(deliverableRow);
  if (!deliverable) {
    throw new AppError("Link không tồn tại hoặc đã bị thu hồi.", 404);
  }
  if (deliverable.status === "archived") {
    throw new AppError("Sản phẩm này đã ngừng chia sẻ.", 410);
  }
  return {
    link,
    deliverable,
    round: Round.fromRow(roundRow),
    order: order || null,
    orderStatus: order?.status || null,
  };
}

/**
 * Khách mở link. Chỉ trả thứ màn review cần: tên, sản phẩm, file hoặc địa chỉ site, vòng hiện tại.
 * Không trả sdkKey, version, ghi chú nội bộ, thành viên.
 */
export async function openByToken(token) {
  const {
    link,
    deliverable: d,
    round,
    order,
    orderStatus,
  } = await loadLinkContext(token);
  const openedAt = now();
  const [pub] = await Promise.all([
    toPublicDeliverable(d, { showKey: false }),
    // Thống kê mở link: mỗi lần gọi đếm một lượt (frontend đã biết). Lỗi ghi không được chặn khách.
    // Chờ ghi xong mới trả lời, như bản cũ: team mở danh sách link ngay sau đó phải thấy lượt mở này.
    // updated_at đổi theo như bản cũ; version thì không (không phải thay đổi người dùng làm).
    run(
      sql`UPDATE share_links SET last_opened_at = ${openedAt}, open_count = open_count + 1,
            updated_at = ${openedAt}
          WHERE id = ${link.id}`
    ).catch((err) => logger.warn({ err }, "Không ghi được lượt mở link")),
  ]);

  // Ảnh chụp trang: khách chỉ thấy ghim của góp ý họ được thấy (đã gửi, không phải "chỉ team"),
  // để không lộ cả sự tồn tại của ghi chú nội bộ.
  const pinnedIds = [
    ...new Set(
      pub.versions.flatMap((version) =>
        version.pages.flatMap((page) => page.pins.map((pin) => pin.feedbackId))
      )
    ),
  ];
  if (pinnedIds.length > 0) {
    // Chỉ hỏi đúng các góp ý đang có ghim trên ảnh, không nạp cả danh sách góp ý của sản phẩm.
    const visible = await all(sql`
      SELECT id FROM feedback
      WHERE id IN ${sql.list(pinnedIds)} AND deliverable_id = ${d.id}
        AND visibility = 'customer' AND status <> 'draft'`);
    const visibleIds = new Set(visible.map((fb) => fb.id));
    for (const version of pub.versions) {
      for (const page of version.pages) {
        page.pins = page.pins.filter((pin) => visibleIds.has(pin.feedbackId));
      }
    }
  }
  // Khách xem đúng bộ file của vòng hiện tại (bản team đã gửi), không phải bản team đang sửa dở.
  const current = pub.versions[pub.versions.length - 1];
  const files = current ? current.files : pub.files;
  const currentIds = new Set(files.map((f) => f.id));
  // Bản cũ cho khách: chỉ file của các vòng trước, tức những bản đã từng gửi cho họ.
  // File team giữ lại vì có ghi chú nhưng chưa từng gửi (thay trước khi gửi) thì khách không được thấy.
  const older = new Map();
  for (const version of pub.versions.slice(0, -1)) {
    for (const file of version.files) older.set(file.id, file);
  }
  const previousFiles = [...older.values()].filter(
    (file) => !currentIds.has(file.id)
  );
  return {
    link: {
      status: link.status,
      // Gửi góp ý, xác nhận và duyệt được khi link đang chia sẻ và vòng còn mở.
      canComment:
        link.status === "active" &&
        round?.status === "open" &&
        orderStatus !== "delivered",
    },
    contactName: link.contactName,
    order: {
      title: order.title,
      type: order.type,
      // Đơn đã bàn giao thì màn của khách chỉ còn để xem.
      delivered: orderStatus === "delivered",
    },
    client: { name: order.clientName || null },
    deliverable: {
      id: pub.id,
      type: pub.type,
      name: pub.name,
      url: pub.url,
      files,
      previousFiles,
      // Bộ file khách được xem ở từng vòng, để đối chiếu bản trước và bản sau.
      versions: pub.versions,
    },
    round: round
      ? {
          number: round.number,
          status: round.status,
          note: round.note || null,
          openedAt: round.openedAt,
        }
      : null,
  };
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}
