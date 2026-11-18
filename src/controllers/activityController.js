import * as activityService from "../services/activityService.js";

export const getOrderActivity = async (c) => {
  const { params, query } = c.get("valid");
  const { activity, nextCursor } = await activityService.listForOrder(
    c.get("actor"),
    params.id,
    query
  );

  return c.json({
    status: "success",
    results: activity.length,
    nextCursor,
    data: { activity },
  });
};
