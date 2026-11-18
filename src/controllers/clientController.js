import * as clientService from "../services/clientService.js";

export const getClients = async (c) => {
  const { clients, nextCursor } = await clientService.listClients(
    c.get("actor"),
    c.get("valid").query
  );

  return c.json({
    status: "success",
    results: clients.length,
    nextCursor,
    data: { clients },
  });
};

export const getClient = async (c) => {
  const client = await clientService.getClient(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    data: { client },
  });
};

export const updateClient = async (c) => {
  const { params, body } = c.get("valid");
  const client = await clientService.updateClient(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { client },
  });
};
