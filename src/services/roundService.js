import { activeFiles } from "./deliverableService.js";

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
