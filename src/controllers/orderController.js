import * as orderService from "../services/orderService.js";

export const getOrders = async (c) => {
  const { orders, nextCursor } = await orderService.listOrders(
    c.get("actor"),
    c.get("valid").query
  );

  return c.json({
    status: "success",
    results: orders.length,
    nextCursor,
    data: { orders },
  });
};

export const getOrder = async (c) => {
  const order = await orderService.getOrder(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    data: { order },
  });
};

export const createOrder = async (c) => {
  const order = await orderService.createOrder(
    c.get("actor"),
    c.get("valid").body
  );

  return c.json(
    {
      status: "success",
      data: { order },
    },
    201
  );
};

export const updateOrder = async (c) => {
  const { params, body } = c.get("valid");
  const order = await orderService.updateOrder(c.get("actor"), params.id, body);

  return c.json({
    status: "success",
    data: { order },
  });
};

export const setOrderMembers = async (c) => {
  const { params, body } = c.get("valid");
  const order = await orderService.setOrderMembers(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { order },
  });
};

export const deliverOrder = async (c) => {
  const { params, body } = c.get("valid");
  const order = await orderService.deliverOrder(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { order },
  });
};

export const reopenOrder = async (c) => {
  const { params, body } = c.get("valid");
  const order = await orderService.reopenOrder(c.get("actor"), params.id, body);

  return c.json({
    status: "success",
    data: { order },
  });
};

export const getAssignableMembers = async (c) => {
  const members = await orderService.listAssignableMembers(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    results: members.length,
    data: { members },
  });
};
