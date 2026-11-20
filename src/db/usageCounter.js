/**
 * Bộ đếm mức dùng trong bộ nhớ của isolate, kể từ lần ghi xuống gần nhất: số request vào Worker (chia theo người gọi và
 * theo mã trả về đáng chú ý) và số dòng D1 đã đọc, đã ghi.
 * Chỉ là vài con số cộng dồn, không gọi database: lớp d1.js và điểm vào của Worker gọi vào đây ở mọi request mà không tốn gì.
 * Việc ghi xuống D1 theo lô nằm ở services/usageService.js (file này không import gì để d1.js dùng được mà không vòng).
 *
 * Isolate bị tắt thì phần chưa ghi xuống mất: số đếm là ước lượng, hơi thấp hơn thực tế.
 */
const KEYS = [
  "requests",
  "rowsRead",
  "rowsWritten",
  "member",
  "guest",
  "anonymous",
  "status404",
  "status429",
  "status5xx",
  "paused",
];

const zero = () => Object.fromEntries(KEYS.map((key) => [key, 0]));

let pending = zero();

/** Một request vừa vào Worker. */
export const countRequest = () => {
  pending.requests += 1;
};

/** `meta` của một kết quả D1 (D1Result.meta): cộng số dòng câu đó đã đọc và đã ghi. */
export const countRows = (meta) => {
  if (!meta) return;
  pending.rowsRead += meta.rows_read || 0;
  pending.rowsWritten += meta.rows_written || 0;
};

// Request đã được nhận ra là của một thành viên có phiên hợp lệ (đánh dấu ở chỗ đọc phiên). Giữ bằng WeakSet theo chính
// object Request nên không cần dọn, và không đi qua header hay response.
const members = new WeakSet();

/** Đánh dấu request là của thành viên đã đăng nhập (gọi sau khi đọc phiên thành công). */
export const markMember = (request) => {
  members.add(request);
};

// Request bị từ chối vì hệ thống đang tạm ngừng (503 "quota_paused", hoặc kết nối trực tiếp bị đóng mã 4503).
const refused = new WeakSet();

/** Đánh dấu request là bị từ chối vì tạm ngừng: đếm riêng ở `paused`, không tính là lỗi 5xx. */
export const markPaused = (request) => {
  refused.add(request);
};

// Đường của khách mở link chia sẻ, token đúng dạng: /api/v1/r/<32 ký tự>, hoặc kết nối trực tiếp kèm ?token=.
const GUEST_PATH = /^\/api\/v1\/r\/[A-Za-z0-9_-]{32}(\/|$)/;
const GUEST_SOCKET =
  /^\/api\/v1\/realtime\/?\?(.*&)?token=[A-Za-z0-9_-]{32}(&|$)/;

/**
 * Request vừa được trả lời: phân loại người gọi và ghi nhận mã trả về (404, 429, 5xx), hoặc việc bị từ chối vì tạm ngừng.
 *   member     có phiên hợp lệ
 *   guest      đường của link chia sẻ với token đúng dạng (chưa chắc token có thật)
 *   anonymous  còn lại: chưa đăng nhập, đường lạ, dò quét. Phần lớn lưu lượng của bot rơi vào đây.
 */
export const countOutcome = (request, status) => {
  if (members.has(request)) pending.member += 1;
  else {
    const start = request.url.indexOf("/", 8);
    const path = start < 0 ? "/" : request.url.slice(start);
    if (GUEST_PATH.test(path) || GUEST_SOCKET.test(path)) pending.guest += 1;
    else pending.anonymous += 1;
  }
  if (refused.has(request)) pending.paused += 1;
  else if (status === 404) pending.status404 += 1;
  else if (status === 429) pending.status429 += 1;
  else if (status >= 500) pending.status5xx += 1;
};

/** Phần chưa ghi xuống (bản sao, chỉ để đọc). */
export const pendingUsage = () => ({ ...pending });

/** Phần chưa ghi xuống, chính object đang đếm: CHỈ ĐỌC, dùng ở đường nóng để khỏi tạo bản sao mỗi request. */
export const peekUsage = () => pending;

/** Lấy phần chưa ghi xuống và đặt bộ đếm về 0. */
export const takeUsage = () => {
  const taken = pending;
  pending = zero();
  return taken;
};

/** Trả lại phần đã lấy khi ghi xuống không thành, để lượt sau ghi tiếp. */
export const restoreUsage = (usage) => {
  for (const key of KEYS) pending[key] += usage[key] || 0;
};

/** true khi không có gì để ghi. */
export const isEmptyUsage = (usage) => KEYS.every((key) => !usage[key]);
