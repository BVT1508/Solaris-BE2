/**
 * Che token của link chia sẻ trong đường dẫn trước khi ghi log: /api/v1/r/<token>/... chỉ giữ 6 ký tự đầu,
 * đủ để lần theo một link trong log nhưng không đủ để mở link. Token ở query (?token=) của kết nối trực tiếp cũng che.
 */
const redactUrl = (url) =>
  typeof url === "string"
    ? url
        .replace(/(\/r\/)([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{10,}/, "$1$2...")
        .replace(/([?&]token=)([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{10,}/, "$1$2...")
    : url;

export default redactUrl;
