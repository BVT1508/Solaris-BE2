import { run } from "../db/d1.js";
import { AuditLog } from "../models/index.js";
import { newId } from "./id.js";
import { now } from "./time.js";

/**
 * Câu lệnh ghi nhật ký, để đặt vào cuối lô của `transact`: thao tác và nhật ký cùng thành hoặc cùng mất.
 *   auditStatement({ actor, action: "member.suspend", entityType: "member", entityId, before, after })
 * Việc trong một đơn thì truyền thêm orderId (và deliverableId nếu gắn với một sản phẩm) để hiện ở "Hoạt động" của đơn.
 */
export const auditStatement = ({
  actor,
  action,
  entityType,
  entityId,
  orderId,
  deliverableId,
  before,
  after,
}) =>
  AuditLog.insert({
    id: newId(),
    org: actor.orgId,
    actorKind: actor.kind,
    actorMember: actor.kind === "member" ? actor.memberId : undefined,
    actorLabel: actor.name,
    action,
    entityType,
    entityId,
    order: orderId,
    deliverable: deliverableId,
    before,
    after,
    at: now(),
  });

/** Ghi nhật ký riêng lẻ, cho thao tác chỉ có một câu ghi và không cần lô. */
export const logAudit = async (entry) => {
  await run(auditStatement(entry));
};
