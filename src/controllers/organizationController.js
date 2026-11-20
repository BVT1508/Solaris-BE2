import * as organizationService from "../services/organizationService.js";

export const getEmbed = async (c) => {
  const embed = await organizationService.getEmbed(c.get("actor"));

  return c.json({
    status: "success",
    data: { embed },
  });
};

export const rotateEmbed = async (c) => {
  const embed = await organizationService.rotateEmbed(c.get("actor"));

  return c.json({
    status: "success",
    data: { embed },
  });
};
