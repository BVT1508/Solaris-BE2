import * as shareLinkService from "../services/shareLinkService.js";

export const createShareLink = async (c) => {
  const { params, body } = c.get("valid");
  const { shareLink, round, orderStatus } =
    await shareLinkService.createShareLink(c.get("actor"), params.id, body);

  return c.json(
    {
      status: "success",
      data: { shareLink, round, orderStatus },
    },
    201
  );
};

export const getShareLinks = async (c) => {
  const shareLinks = await shareLinkService.listShareLinks(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    results: shareLinks.length,
    data: { shareLinks },
  });
};

export const getRounds = async (c) => {
  const rounds = await shareLinkService.listRounds(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    results: rounds.length,
    data: { rounds },
  });
};

export const updateShareLink = async (c) => {
  const { params, body } = c.get("valid");
  const shareLink = await shareLinkService.updateShareLink(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { shareLink },
  });
};

export const pauseShareLink = async (c) => {
  const { params, body } = c.get("valid");
  const shareLink = await shareLinkService.pauseShareLink(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { shareLink },
  });
};

export const resumeShareLink = async (c) => {
  const { params, body } = c.get("valid");
  const shareLink = await shareLinkService.resumeShareLink(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { shareLink },
  });
};

export const revokeShareLink = async (c) => {
  const { params, body } = c.get("valid");
  const { shareLink, remaining } = await shareLinkService.revokeShareLink(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { shareLink, remaining },
  });
};

/** Công khai: khách mở link, không cần đăng nhập. */
export const openReview = async (c) => {
  const review = await shareLinkService.openByToken(
    c.get("valid").params.token
  );

  return c.json({
    status: "success",
    data: { review },
  });
};
