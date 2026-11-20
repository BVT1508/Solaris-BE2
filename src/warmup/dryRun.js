import { runDry } from "../config/runtime.js";

/**
 * Chạy MỘT request mẫu qua app trong ngữ cảnh chạy khô (config/runtime.js). Dùng chung cho hai nơi, để lúc ghi và lúc
 * phát lại đi đúng một đường code:
 *   - src/warmup.js: lúc nạp module, database là bản phát lại kết quả đã ghi (replayDb);
 *   - scripts/record-warmup.mjs: lúc ghi, database là SQLite thật bọc thêm phần ghi lại kết quả.
 *
 * Một request mẫu: { m: phương thức, p: đường dẫn, h: header, b: body dạng chuỗi JSON (có thể thiếu) }.
 */
const ORIGIN = "https://warmup.invalid";
const encoder = new TextEncoder();

/**
 * Byte "ngẫu nhiên" tất định cho lúc chạy khô (Worker cấm sinh số ngẫu nhiên lúc nạp module). Mỗi request mẫu bắt đầu từ
 * cùng một hạt giống, nên lúc ghi và lúc phát lại sinh đúng cùng dãy id và token. Không bao giờ dùng cho request thật.
 */
const fixedBytes = () => {
  let state = 0x9e3779b9;
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      out[i] = state & 255;
    }
    return out;
  };
};

const limiter = { limit: async () => ({ success: true }) };
const hub = { publish: async () => {}, disconnect: async () => {} };
const namespace = { idFromName: () => "hub", get: () => hub };

/** Chạy request mẫu `entry` qua `app` với database `db` (cùng giao diện với D1). Trả mã trạng thái của response. */
export async function dryFetch(app, entry, db, random = fixedBytes()) {
  const context = {
    bindings: {
      DB: db,
      REALTIME: namespace,
      API_LIMITER: limiter,
      AUTH_LIMITER: limiter,
      PUBLIC_LIMITER: limiter,
      GUEST_WRITE_LIMITER: limiter,
      SOCKET_LIMITER: limiter,
    },
    randomBytes: random,
    body: entry.b === undefined ? undefined : encoder.encode(entry.b),
  };
  // Request không mang body thật (luồng body không đọc được lúc nạp module): bodyMiddleware lấy body từ ngữ cảnh.
  const headers = { ...entry.h };
  if (entry.b !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(context.body.byteLength);
  }
  const request = new Request(ORIGIN + entry.p, { method: entry.m, headers });

  // Lúc nạp module Worker cũng cấm tạo Response có body (`new Response("chuỗi")`), còn Response không body thì được.
  // Hono tạo response bằng `new Response(...)` lấy từ biến toàn cục ở lúc gọi, nên trong lúc chạy khô biến đó được trỏ
  // tạm sang một lớp con bỏ body đi: mã trạng thái và header vẫn đúng, mọi đoạn code của app vẫn chạy như thật.
  // An toàn vì hàm này chỉ chạy lúc nạp module (chưa có request thật nào) và trong script ghi; luôn trả lại ở `finally`.
  const RealResponse = globalThis.Response;
  globalThis.Response = class DryResponse extends RealResponse {
    constructor(_body, init) {
      super(null, init);
    }
  };
  try {
    const response = await runDry(context, () => app.fetch(request));
    return response.status;
  } finally {
    globalThis.Response = RealResponse;
  }
}

/** Bộ sinh byte tất định dùng xuyên suốt nhiều request (lúc dựng dữ liệu nền khi ghi, để id không trùng nhau). */
export const sharedBytes = fixedBytes;

/**
 * Database giả phát lại các kết quả đã ghi, theo đúng thứ tự, không nhìn câu SQL. Mỗi phần tử của `recorded` là:
 *   [dòng, số dòng đổi]              kết quả của một câu lẻ
 *   { b: [[dòng, số dòng đổi], ...] } kết quả của một lô (batch)
 *   { e: "lời lỗi" }                 câu hoặc lô đó ném lỗi
 * Code đổi làm thứ tự truy vấn lệch đi thì `stale` thành true và request mẫu kết thúc bằng lỗi: vô hại, chỉ kém nóng.
 */
export function replayDb(recorded) {
  const state = { at: 0, stale: false };
  const toResult = ([results, changes]) => ({
    success: true,
    results,
    meta: { changes, rows_read: 0, rows_written: 0 },
  });
  const next = (wantBatch, size) => {
    const item = recorded[state.at];
    state.at += 1;
    if (
      item === undefined ||
      (wantBatch ? !item.b && !item.e : !Array.isArray(item) && !item.e)
    ) {
      state.stale = true;
      throw new Error("WARMUP_STALE: thứ tự truy vấn khác bản ghi");
    }
    if (item.e) throw new Error(item.e);
    if (wantBatch && item.b.length !== size) {
      state.stale = true;
      throw new Error("WARMUP_STALE: số câu trong lô khác bản ghi");
    }
    return wantBatch ? item.b.map(toResult) : toResult(item);
  };
  const statement = {
    bind: () => statement,
    all: async () => next(false),
    run: async () => next(false),
    first: async () => next(false).results[0] ?? null,
  };
  return {
    prepare: () => statement,
    batch: async (statements) => next(true, statements.length),
    /** true khi mọi kết quả đã ghi được dùng hết và không lệch chỗ nào. */
    complete: () => !state.stale && state.at === recorded.length,
  };
}
