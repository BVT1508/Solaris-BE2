import * as memberService from "../services/memberService.js";

export const getMembers = async (c) => {
  const members = await memberService.listMembers(
    c.get("actor"),
    c.get("valid").query
  );

  return c.json({
    status: "success",
    results: members.length,
    data: { members },
  });
};

export const getMember = async (c) => {
  const member = await memberService.getMember(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    data: { member },
  });
};

export const createMember = async (c) => {
  const member = await memberService.createMember(
    c.get("actor"),
    c.get("valid").body
  );

  return c.json(
    {
      status: "success",
      data: { member },
    },
    201
  );
};

export const updateMember = async (c) => {
  const { params, body } = c.get("valid");
  const member = await memberService.updateMember(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { member },
  });
};

export const suspendMember = async (c) => {
  const { params, body } = c.get("valid");
  const member = await memberService.suspendMember(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { member },
  });
};

export const activateMember = async (c) => {
  const { params, body } = c.get("valid");
  const member = await memberService.activateMember(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { member },
  });
};
