// Hook nạp module của Node cho scripts/record-warmup.mjs: thay module "cloudflare:workers" (chỉ có trong Worker)
// bằng bản giả ở workers-stub.mjs, để chạy được code của src/ ngay trong Node.
const STUB = new URL("./workers-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
