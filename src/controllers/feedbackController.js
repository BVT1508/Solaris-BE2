import * as feedbackService from "../services/feedbackService.js";

/** Danh sách của team: `truncated` nằm ở đầu body, ngang hàng `results`. */
const sendList = (c, { feedback, truncated }) =>
  c.json({
    status: "success",
    results: feedback.length,
    truncated,
    data: { feedback },
  });

const sendOne = (c, feedback, status = 200) =>
  c.json({ status: "success", data: { feedback } }, status);

export const getDeliverableFeedback = async (c) => {
  const { params, query } = c.get("valid");
  return sendList(
    c,
    await feedbackService.listForTeam(c.get("actor"), params.id, query)
  );
};

export const getOrderFeedback = async (c) => {
  const { params, query } = c.get("valid");
  return sendList(
    c,
    await feedbackService.listForOrder(c.get("actor"), params.id, query)
  );
};

export const getMyFeedback = async (c) =>
  sendList(
    c,
    await feedbackService.listMine(c.get("actor"), c.get("valid").query)
  );

export const getFeedback = async (c) =>
  sendOne(
    c,
    await feedbackService.getForTeam(c.get("actor"), c.get("valid").params.id)
  );

export const createFeedback = async (c) => {
  const { params, body } = c.get("valid");
  const { feedback, created } = await feedbackService.createByMember(
    c.get("actor"),
    params.id,
    body
  );

  // 201 khi tạo mới; 200 khi là lần gửi lại của cùng clientId.
  return sendOne(c, feedback, created ? 201 : 200);
};

export const triageFeedback = async (c) => {
  const { params, body } = c.get("valid");
  return sendOne(
    c,
    await feedbackService.triage(c.get("actor"), params.id, body)
  );
};

export const createReply = async (c) => {
  const { params, body } = c.get("valid");
  return sendOne(
    c,
    await feedbackService.replyByMember(c.get("actor"), params.id, body),
    201
  );
};

export const deleteFeedback = async (c) => {
  await feedbackService.deleteByMember(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({ status: "success", data: null });
};

/** Màn góp ý của team hỏi khóa mà bridge trong site báo lên có đúng của sản phẩm này không. */
export const checkBridge = async (c) => {
  const { params, body } = c.get("valid");
  const { valid } = await feedbackService.checkBridgeForMember(
    c.get("actor"),
    params.id,
    body.sdkKey
  );

  return c.json({ status: "success", data: { valid } });
};
