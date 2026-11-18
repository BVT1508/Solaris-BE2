import * as feedbackService from "../services/feedbackService.js";

/**
 * Góp ý của khách (không đăng nhập). Ngữ cảnh của khách do middleware/guestMiddleware.js gắn vào c.get("guest"):
 * { link, deliverable, round, order, orderStatus, deviceHash, actor }.
 */
const sendOne = (c, feedback, status = 200) =>
  c.json({ status: "success", data: { feedback } }, status);

export const getFeedback = async (c) => {
  const { feedback, otherDrafts } = await feedbackService.listForGuest(
    c.get("guest")
  );

  return c.json({
    status: "success",
    results: feedback.length,
    data: { feedback, otherDrafts },
  });
};

export const createFeedback = async (c) => {
  const { feedback, created } = await feedbackService.createByGuest(
    c.get("guest"),
    c.get("valid").body
  );

  // 201 khi tạo mới; 200 khi là lần gửi lại của cùng clientId.
  return sendOne(c, feedback, created ? 201 : 200);
};

export const updateFeedback = async (c) => {
  const { params, body } = c.get("valid");
  return sendOne(
    c,
    await feedbackService.updateDraftByGuest(c.get("guest"), params.id, body)
  );
};

export const attachScreenshot = async (c) => {
  const { params, body } = c.get("valid");
  return sendOne(
    c,
    await feedbackService.attachScreenshotByGuest(
      c.get("guest"),
      params.id,
      body
    )
  );
};

export const deleteFeedback = async (c) => {
  await feedbackService.deleteDraftByGuest(
    c.get("guest"),
    c.get("valid").params.id
  );

  return c.json({ status: "success", data: null });
};

export const createReply = async (c) => {
  const { params, body } = c.get("valid");
  return sendOne(
    c,
    await feedbackService.replyByGuest(c.get("guest"), params.id, body),
    201
  );
};

/** Khách xác nhận một góp ý đã sửa: "Đã đúng" hoặc "Cần sửa tiếp". */
export const giveVerdict = async (c) => {
  const { params, body } = c.get("valid");
  return sendOne(
    c,
    await feedbackService.verdictByGuest(c.get("guest"), params.id, body)
  );
};

/** Xin chỗ đẩy ảnh chụp màn hình trước khi gửi góp ý trên site web. */
export const createUpload = async (c) => {
  const upload = await feedbackService.createGuestUpload(
    c.get("guest"),
    c.get("valid").body
  );

  return c.json({ status: "success", data: { upload } });
};

/** Màn review hỏi khóa mà bridge trong site báo lên có đúng của sản phẩm này không. */
export const checkBridge = async (c) => {
  const { valid } = await feedbackService.checkBridge(
    c.get("guest"),
    c.get("valid").body.sdkKey
  );

  return c.json({ status: "success", data: { valid } });
};
