import { AsyncLocalStorage } from "node:async_hooks";
import { env as bindings, waitUntil as keepAlive } from "cloudflare:workers";

/**
 * Cửa duy nhất tới những thứ Worker CẤM dùng lúc nạp module: binding (D1, bộ giới hạn tần suất, Durable Object),
 * waitUntil, và số ngẫu nhiên. Lý do có file này: việc "làm nóng" (src/warmup.js) chạy thử vài request mẫu qua cả app
 * ngay lúc nạp module, để request thật đầu tiên của mỗi isolate không phải gánh chi phí lần chạy đầu của code.
 * Lúc đó không được gọi I/O hay sinh số ngẫu nhiên, nên các lời gọi ấy đi qua đây và được thay bằng bản giả.
 *
 * "Chạy khô" là một ngữ cảnh AsyncLocalStorage: chỉ đoạn code chạy BÊN TRONG `runDry(...)` (và các bước await của nó)
 * mới thấy bản giả. Request thật chạy ngoài ngữ cảnh đó nên luôn nhận binding thật, kể cả nếu có lúc chạy xen kẽ:
 * không có cờ toàn cục nào để quên tắt.
 *
 * Luật: code trong src/ KHÔNG gọi thẳng `env.DB`, `waitUntil` của "cloudflare:workers" hay `crypto.getRandomValues`
 * ở đường mà request thường đi qua; dùng `binding`, `waitUntil`, `randomBytes` ở đây.
 */
const dryRun = new AsyncLocalStorage();

/** Chạy `task` trong ngữ cảnh chạy khô. context: { bindings, randomBytes(length), body }. Chỉ src/warmup gọi. */
export const runDry = (context, task) => dryRun.run(context, task);

/** Ngữ cảnh chạy khô hiện tại; undefined khi đang phục vụ request thật. */
export const dry = () => dryRun.getStore();

/** Binding của Cloudflare theo tên ("DB", "REALTIME", "API_LIMITER"...). */
export const binding = (name) => {
  const context = dryRun.getStore();
  return context ? context.bindings[name] : bindings[name];
};

/** Giữ request sống tới khi `promise` xong (việc chạy sau response). */
export const waitUntil = (promise) => {
  if (dryRun.getStore()) {
    Promise.resolve(promise).catch(() => {});
    return;
  }
  keepAlive(promise);
};

/** `length` byte ngẫu nhiên an toàn (Uint8Array). */
export const randomBytes = (length) => {
  const context = dryRun.getStore();
  return context
    ? context.randomBytes(length)
    : crypto.getRandomValues(new Uint8Array(length));
};
