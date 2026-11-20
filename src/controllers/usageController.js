import * as usageService from "../services/usageService.js";

export const getUsage = async (c) => {
  const usage = await usageService.getUsage();

  return c.json({
    status: "success",
    data: { usage },
  });
};

export const getInfrastructure = async (c) => {
  const infrastructure = await usageService.getInfrastructure();

  return c.json({
    status: "success",
    data: { infrastructure },
  });
};
