import * as roundService from "../services/roundService.js";

/** Team bấm "Gửi khách xem lại": mở vòng kế. */
export const openRound = async (c) => {
  const { params, body } = c.get("valid");
  const { round, orderStatus, pending } = await roundService.openNextRound(
    c.get("actor"),
    params.id,
    body
  );

  return c.json(
    {
      status: "success",
      data: { round, orderStatus, pending },
    },
    201
  );
};

/** Team bấm "Cập nhật bản đang gửi": chụp lại bộ file cho vòng đang mở khi chưa ai góp ý. */
export const refreshRound = async (c) => {
  const { round } = await roundService.refreshCurrentRound(
    c.get("actor"),
    c.get("valid").params.id
  );

  return c.json({
    status: "success",
    data: { round },
  });
};

/** Team xin chỗ đẩy ảnh chụp cả trang của sản phẩm web. */
export const createPageShotUpload = async (c) => {
  const { params, body } = c.get("valid");
  const upload = await roundService.createShotUpload(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { upload },
  });
};

/** Team lưu bộ ảnh chụp trang của vòng mới nhất (bản theo vòng của sản phẩm web). */
export const setRoundPages = async (c) => {
  const { params, body } = c.get("valid");
  const { round } = await roundService.setCurrentPages(
    c.get("actor"),
    params.id,
    body
  );

  return c.json({
    status: "success",
    data: { round },
  });
};

/** Khách bấm "Gửi góp ý cho team": khép vòng. */
export const submitRound = async (c) => {
  const { round, submitted, reopened, orderStatus } =
    await roundService.submitByGuest(c.get("guest"));

  return c.json({
    status: "success",
    data: { round, submitted, reopened, orderStatus },
  });
};

/** Khách bấm "Duyệt" sản phẩm. */
export const approveRound = async (c) => {
  const { round, confirmed, remaining, orderStatus } =
    await roundService.approveByGuest(c.get("guest"));

  return c.json({
    status: "success",
    data: { round, confirmed, remaining, orderStatus },
  });
};
