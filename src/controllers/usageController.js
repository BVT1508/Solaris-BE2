import * as usageService from "../services/usageService.js";

export const getUsage = async (c) => {
  const usage = await usageService.getUsage();

  return c.json({
    status: "success",
    data: { usage },
  });
};
