import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import env from "../config/env.js";
import * as authService from "../services/authService.js";
import AppError from "../utils/appError.js";
import { disconnectMember, socketIdOf } from "../utils/realtime.js";

const COOKIE_NAME = "solaris_sid";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const cookieOptions = () => ({
  httpOnly: true,
  secure: !env.IS_DEV,
  sameSite: "Lax",
  path: "/",
  domain: env.COOKIE_DOMAIN,
});

const setSessionCookie = async (c, member) => {
  const token = await authService.createSession(
    member.id,
    c.req.header("user-agent")
  );
  const seconds = env.SESSION_HOURS * 60 * 60;
  setCookie(c, COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: seconds,
    expires: new Date(Date.now() + seconds * 1000),
  });
};

const clearSessionCookie = (c) => deleteCookie(c, COOKIE_NAME, cookieOptions());

const isLoopbackHost = (host) =>
  Boolean(host) &&
  LOOPBACK_HOSTS.has(host.trim().toLowerCase().replace(/:\d+$/, ""));

const loginRedirect = (c, params) => {
  const url = new URL("/login", env.FRONTEND_URL);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return c.redirect(url.toString());
};

/** Chủ hệ thống luôn có mặt, kể cả database trống: kiểm ở request đầu tiên của mỗi isolate vào nhóm /auth. */
export const ensureOwner = async (c, next) => {
  await authService.ensureOwnerOnce();
  await next();
};

// ---------- Đăng nhập dev ----------

/**
 * Chỉ khi chạy máy dev (ENVIRONMENT=development, tức `wrangler dev` đọc .dev.vars; bản deploy luôn là production),
 * Host là loopback (chặn trang lạ dùng DNS rebinding gọi vào dev server), kết nối thật tới từ chính máy này và không đi
 * qua proxy hay tunnel (ngrok, cloudflared... đều gắn header chuyển tiếp). Trên Cloudflare, tên miền của request không bao giờ
 * là loopback, nên kể cả khi lỡ đặt ENVIRONMENT=development ở bản deploy thì cửa này vẫn đóng.
 */
export const requireDevLogin = async (c, next) => {
  const forwarded =
    c.req.header("x-forwarded-for") ||
    c.req.header("forwarded") ||
    c.req.header("x-forwarded-host");
  if (
    !env.DEV_LOGIN_ENABLED ||
    !isLoopbackHost(c.req.header("host")) ||
    !isLoopbackHost(new URL(c.req.url).host) ||
    !LOOPBACK_ADDRESSES.has(c.req.header("cf-connecting-ip")) ||
    forwarded
  ) {
    throw new AppError("Không tìm thấy.", 404);
  }
  await next();
};

export const getDevMembers = async (c) => {
  const members = await authService.listDevLoginMembers();

  return c.json({
    status: "success",
    results: members.length,
    data: { members },
  });
};

export const devLogin = async (c) => {
  const result = await authService.authorizeDevSignIn(
    c.get("valid").body.email
  );
  if (!result.ok) {
    throw new AppError(authService.SIGN_IN_MESSAGES[result.reason], 401);
  }
  await setSessionCookie(c, result.member);

  return c.json({
    status: "success",
    data: { member: authService.toPublicMember(result.member) },
  });
};

// ---------- Đăng nhập Google ----------

export const googleStart = async (c) => {
  const url = await authService.startGoogleSignIn();
  return c.redirect(url);
};

export const googleCallback = async (c) => {
  const query = c.get("valid").query;
  if (query.error) return loginRedirect(c, { error: "google_denied" });

  const result = await authService.finishGoogleSignIn({
    code: query.code,
    state: query.state,
  });
  if (!result.ok) return loginRedirect(c, { error: result.reason });

  await setSessionCookie(c, result.member);
  return c.redirect(env.FRONTEND_URL);
};

// ---------- Phiên ----------

export const getMe = (c) =>
  c.json({
    status: "success",
    data: { member: authService.toPublicMember(c.get("member")) },
  });

export const logout = async (c) => {
  // Hủy phiên rồi đóng luôn các kết nối trực tiếp của người vừa đăng xuất.
  await authService.destroySession(getCookie(c, COOKIE_NAME));
  disconnectMember(c.get("actor").memberId);
  clearSessionCookie(c);
  return c.json({ status: "success", data: null });
};

// ---------- Bảo vệ route ----------

/** Đọc phiên từ cookie, gắn c.get("member") và c.get("actor"). Quyền đọc lại từ database ở mỗi request. */
export const protect = async (c, next) => {
  const resolved = await authService.resolveSession(getCookie(c, COOKIE_NAME));
  if (!resolved) {
    clearSessionCookie(c);
    throw new AppError("Bạn chưa đăng nhập hoặc phiên đã hết hạn.", 401);
  }
  c.set("member", resolved.member);
  // socketId: kết nối trực tiếp của chính tab này, để thay đổi do nó gây ra không báo ngược lại cho nó.
  c.set("actor", { ...resolved.actor, socketId: socketIdOf(c) });
  await next();
};

/** Giới hạn theo vai trò cấp tổ chức. Quyền theo đơn dùng policies/policy.js. */
export const restrictTo =
  (...roles) =>
  async (c, next) => {
    const actor = c.get("actor");
    if (!actor || !roles.includes(actor.role)) {
      throw new AppError("Bạn không có quyền làm việc này.", 403);
    }
    await next();
  };
