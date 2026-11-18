import * as deliverableService from "../services/deliverableService.js";

/** Trả một sản phẩm: mọi thao tác trên sản phẩm đều trả cùng một dạng. */
const sendDeliverable = (c, deliverable, status = 200) =>
  c.json({ status: "success", data: { deliverable } }, status);

export const getDeliverables = async (c) => {
  const { params, query } = c.get("valid");
  const deliverables = await deliverableService.listDeliverables(
    c.get("actor"),
    params.id,
    query
  );

  return c.json({
    status: "success",
    results: deliverables.length,
    data: { deliverables },
  });
};

export const createDeliverable = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.createDeliverable(
    c.get("actor"),
    params.id,
    body
  );

  return sendDeliverable(c, deliverable, 201);
};

export const getDeliverable = async (c) => {
  const deliverable = await deliverableService.getDeliverable(
    c.get("actor"),
    c.get("valid").params.id
  );

  return sendDeliverable(c, deliverable);
};

export const updateDeliverable = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.updateDeliverable(
    c.get("actor"),
    params.id,
    body
  );

  return sendDeliverable(c, deliverable);
};

export const archiveDeliverable = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.archiveDeliverable(
    c.get("actor"),
    params.id,
    body
  );

  return sendDeliverable(c, deliverable);
};

export const restoreDeliverable = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.restoreDeliverable(
    c.get("actor"),
    params.id,
    body
  );

  return sendDeliverable(c, deliverable);
};

export const createUploadUrl = async (c) => {
  const { params, body } = c.get("valid");
  const upload = await deliverableService.createUploadUrl(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { upload },
  });
};

export const attachFile = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.attachFile(
    c.get("actor"),
    params.id,
    body
  );

  return sendDeliverable(c, deliverable);
};

export const removeFile = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.removeFile(
    c.get("actor"),
    params.id,
    params.fileId,
    body
  );

  return sendDeliverable(c, deliverable);
};

export const rotateSdkKey = async (c) => {
  const { params, body } = c.get("valid");
  const deliverable = await deliverableService.rotateSdkKey(
    c.get("actor"),
    params.id,
    body
  );

  return sendDeliverable(c, deliverable);
};
