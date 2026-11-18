import { createHash } from "node:crypto";
import env from "../config/env.js";
import { all, first, guard, run, sql, transact } from "../db/d1.js";
import Member, { TEAMS_COLUMN, toMember } from "../models/memberModel.js";
import { OauthState, Session } from "../models/index.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { randomToken, sha256Hex } from "../utils/hash.js";
import { newId } from "../utils/id.js";
import { toSearchText } from "../utils/searchText.js";
import { fromNow, now } from "../utils/time.js";

const SESSION_MS = env.SESSION_HOURS * 60 * 60 * 1000;
const OAUTH_STATE_MS = 10 * 60 * 1000;
const GOOGLE_REDIRECT_URI = `${env.API_PUBLIC_URL}/api/v1/auth/google/callback`;

export const SIGN_IN_MESSAGES = {
  not_invited: "Email này chưa được cấp quyền. Hãy liên hệ quản trị viên.",
  suspended: "Tài khoản đang bị tạm khóa.",
  unverified: "Google chưa xác minh email này.",
  identity_mismatch: "Email này đã gắn với một tài khoản Google khác.",
  state_invalid: "Phiên đăng nhập Google đã hết hạn. Hãy thử lại.",
  google_denied: "Bạn đã hủy đăng nhập Google.",
};

/** Cookie giữ token; database chỉ giữ băm, nên lộ database cũng không dùng lại được phiên. */
export const hashToken = (token) => sha256Hex(token);

const systemActor = (orgId) => ({
  kind: "system",
  orgId,
  name: "Hệ thống",
});

// ---------- Tổ chức và chủ hệ thống ----------

async function getOrCreateOrg() {
  const org = await first(sql`SELECT id FROM organizations LIMIT 1`);
  if (org) return org.id;
  const at = now();
  // Hai isolate cùng khởi động trên database trống: chỉ một bên chèn được.
  await run(sql`
    INSERT INTO organizations (id, name, created_at, updated_at)
    SELECT ${newId()}, ${"Công ty"}, ${at}, ${at}
    WHERE NOT EXISTS (SELECT 1 FROM organizations)`);
  return (await first(sql`SELECT id FROM organizations LIMIT 1`)).id;
}

/**
 * Chủ hệ thống (OWNER_EMAIL) luôn tồn tại và luôn là admin đang hoạt động hoặc đã mời, kể cả database trống sau deploy.
 * Backend cũ gọi lúc server khởi động; Worker không có lúc khởi động để hỏi database, nên gọi qua `ensureOwnerOnce`
 * ở request đầu tiên của mỗi isolate vào nhóm /auth.
 */
export async function ensureOwner() {
  const orgId = await getOrCreateOrg();
  const owner = Member.fromRow(
    await first(sql`SELECT * FROM members WHERE email = ${env.OWNER_EMAIL}`)
  );
  if (!owner) {
    const at = now();
    await run(
      sql`${Member.insert({
        id: newId(),
        org: orgId,
        email: env.OWNER_EMAIL,
        name: "Quản trị viên",
        role: "admin",
        status: "invited",
        searchText: toSearchText("Quản trị viên", env.OWNER_EMAIL),
        createdAt: at,
        updatedAt: at,
      })} ON CONFLICT (email) DO NOTHING`
    );
    return;
  }
  if (owner.role !== "admin" || owner.status === "suspended") {
    const status = owner.status === "suspended" ? "active" : owner.status;
    await transact(async () => ({
      statements: [
        sql`UPDATE members SET role = 'admin', status = ${status}, version = version + 1, updated_at = ${now()}
            WHERE id = ${owner.id}`,
        // Quản trị viên thấy mọi đơn nên không nằm trong team nào: gỡ khỏi team và thôi leader ở mọi đơn.
        sql`DELETE FROM order_members WHERE member_id = ${owner.id}`,
        auditStatement({
          actor: systemActor(orgId),
          action: "member.restoreOwner",
          entityType: "member",
          entityId: owner.id,
          before: { role: owner.role, status: owner.status },
          after: { role: "admin", status },
        }),
      ],
    }));
  }
}

// Biến cấp module sống theo isolate: mỗi isolate chỉ kiểm một lần. Hai request đầu tới cùng lúc có thể cùng kiểm, không sao.
let ownerChecked = false;

export async function ensureOwnerOnce() {
  if (ownerChecked) return;
  await ensureOwner();
  ownerChecked = true;
}

// ---------- Actor ----------

const toActor = (member) => ({
  kind: "member",
  memberId: member.id,
  orgId: member.org,
  email: member.email,
  name: member.name,
  role: member.role,
  isOwner: member.email === env.OWNER_EMAIL,
  orderIds: new Set(member.role === "admin" ? [] : member.orders || []),
  // Đơn mà người này là leader. Chỉ nhân viên mới cần: quản lý đã có quyền leader ở mọi đơn mình tham gia,
  // người chỉ xem thì không bao giờ là leader (policy kiểm lại theo vai trò).
  leadOrderIds: new Set(member.role === "staff" ? member.leadOrders || [] : []),
});

/** Dữ liệu trả cho frontend qua /auth/me. */
export const toPublicMember = (member) => ({
  id: member.id,
  email: member.email,
  name: member.name,
  role: member.role,
  status: member.status,
  isOwner: member.email === env.OWNER_EMAIL,
  orders: member.orders || [],
  // Đơn mà người này là leader: giao diện dùng để hiện nút của leader (sửa đơn, tạo link, gửi khách xem lại...).
  leadOrders: member.role === "staff" ? member.leadOrders || [] : [],
  skills: member.skills || [],
});

const findMemberByEmail = async (email) =>
  toMember(
    await first(
      sql`SELECT m.*, ${TEAMS_COLUMN} FROM members m WHERE m.email = ${email}`
    )
  );

// ---------- Phiên ----------

export async function createSession(memberId, userAgent) {
  const token = randomToken(32);
  const at = now();
  await run(
    Session.insert({
      id: newId(),
      tokenHash: hashToken(token),
      member: memberId,
      expiresAt: fromNow(SESSION_MS),
      userAgent: userAgent ? String(userAgent).slice(0, 200) : undefined,
      createdAt: at,
      updatedAt: at,
    })
  );
  return token;
}

export async function destroySession(token) {
  if (typeof token !== "string" || !token) return;
  await run(sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`);
}

/** Câu lệnh thu hồi mọi phiên của một thành viên (khi bị khóa), để đặt vào lô của `transact`. */
export const destroyAllSessionsStatement = (memberId) =>
  sql`DELETE FROM sessions WHERE member_id = ${memberId}`;

/**
 * Từ băm của token ra thành viên và actor. Kết nối trực tiếp chỉ giữ băm (không giữ token) nên gọi thẳng hàm này.
 * Phiên và thành viên (kèm các đơn tham gia) trong MỘT truy vấn: bước này chạy ở mọi request có đăng nhập.
 */
export async function resolveSessionByHash(tokenHash) {
  if (typeof tokenHash !== "string" || !tokenHash) return null;
  const row = await first(sql`
    SELECT m.*, ${TEAMS_COLUMN}, s.id AS session_id
    FROM sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > ${now()}`);
  if (!row) return null;

  const member = toMember(row);
  if (member.status !== "active") {
    await run(sql`DELETE FROM sessions WHERE id = ${row.session_id}`);
    return null;
  }
  return { member, actor: toActor(member) };
}

/**
 * Từ token trong cookie ra actor. Đọc lại thành viên ở mỗi request,
 * nên đổi vai trò hay khóa tài khoản có hiệu lực ngay request kế tiếp.
 */
export async function resolveSession(token) {
  if (typeof token !== "string" || !token) return null;
  return resolveSessionByHash(hashToken(token));
}

// ---------- Đăng nhập ----------

/** Lần đăng nhập đầu: kích hoạt tài khoản và gắn danh tính Google. Không ghi đè danh tính đã gắn. */
async function activateMember(member, googleSub) {
  const changes = {};
  if (member.status === "invited") changes.status = "active";
  if (googleSub && !member.googleSub) changes.googleSub = googleSub;
  if (Object.keys(changes).length === 0) return member;

  const updated = { ...member, ...changes, version: member.version + 1 };
  await transact(
    async () => ({
      statements: [
        guard(
          sql`SELECT 1 FROM members WHERE id = ${member.id} AND version = ${member.version}`,
          "stale"
        ),
        sql`UPDATE members SET ${Member.set({ ...changes, updatedAt: now() })}, version = version + 1
            WHERE id = ${member.id}`,
        auditStatement({
          actor: toActor(updated),
          action: "member.activate",
          entityType: "member",
          entityId: member.id,
          before: { status: member.status },
          after: {
            status: updated.status,
            provider: googleSub ? "google" : "dev",
          },
        }),
      ],
    }),
    { errors: { stale: STALE } }
  );
  return updated;
}

/**
 * Chỉ email đã được cấp quyền mới vào. Email phải được Google xác minh.
 * Tài khoản Google gắn cố định từ lần đầu để chống tráo danh tính.
 * Trả { ok: true, member } hoặc { ok: false, reason }.
 */
export async function authorizeGoogleSignIn({
  email,
  emailVerified,
  googleSub,
}) {
  if (!emailVerified) return { ok: false, reason: "unverified" };
  const member = await findMemberByEmail(email.trim().toLowerCase());
  if (!member) return { ok: false, reason: "not_invited" };
  if (member.status === "suspended") return { ok: false, reason: "suspended" };
  if (member.googleSub && member.googleSub !== googleSub) {
    return { ok: false, reason: "identity_mismatch" };
  }
  return { ok: true, member: await activateMember(member, googleSub) };
}

/** Đăng nhập dev: không qua Google. Controller chỉ cho phép khi chạy máy dev và request tới từ chính máy này. */
export async function authorizeDevSignIn(email) {
  const member = await findMemberByEmail(email);
  if (!member) return { ok: false, reason: "not_invited" };
  if (member.status === "suspended") return { ok: false, reason: "suspended" };
  return { ok: true, member: await activateMember(member, null) };
}

/** Giữ khóa `_id` như backend cũ (API này trả thẳng document, không qua toPublic). */
export async function listDevLoginMembers() {
  return all(sql`
    SELECT id AS _id, email, name, role, status FROM members
    WHERE status <> 'suspended' ORDER BY role, name`);
}

// ---------- Google OAuth (authorization code + PKCE), gọi thẳng bằng fetch ----------

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

const assertGoogleEnabled = () => {
  if (!env.GOOGLE_ENABLED) {
    throw new AppError("Chưa cấu hình đăng nhập Google.", 503);
  }
};

export async function startGoogleSignIn() {
  assertGoogleEnabled();
  const codeVerifier = randomToken(48);
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = randomToken(24);
  await run(
    OauthState.insert({
      state,
      codeVerifier,
      expiresAt: fromNow(OAUTH_STATE_MS),
      createdAt: now(),
    })
  );
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    access_type: "online",
    scope: "openid email profile",
    prompt: "select_account",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

const decodePart = (part) =>
  JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));

function base64UrlBytes(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/**
 * Kiểm id_token của Google: chữ ký RS256 bằng khóa công khai của Google, đúng người phát hành, đúng audience, chưa hết hạn.
 * Lỗi ở đây là lỗi phía server (cấu hình sai, Google đổi khóa): ném Error thường để thành 500 có log.
 */
async function verifyGoogleIdToken(idToken) {
  const [headerPart, payloadPart, signaturePart] = String(idToken).split(".");
  if (!signaturePart) throw new Error("id_token của Google sai định dạng.");
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);

  const certs = await fetch(GOOGLE_CERTS_URL).then((res) => res.json());
  const jwk = (certs.keys || []).find((key) => key.kid === header.kid);
  if (!jwk || header.alg !== "RS256") {
    throw new Error("Không tìm thấy khóa ký id_token của Google.");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(signaturePart),
    signed
  );
  if (!valid) throw new Error("Chữ ký id_token của Google không hợp lệ.");
  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error("id_token không do Google phát hành.");
  }
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error("id_token của Google không dành cho ứng dụng này.");
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw new Error("id_token của Google đã hết hạn.");
  }
  return payload;
}

/** Đổi code lấy id_token, kiểm chữ ký và audience, rồi áp luật cấp quyền. */
export async function finishGoogleSignIn({ code, state }) {
  assertGoogleEnabled();
  // Mỗi state chỉ dùng một lần: xóa và lấy code_verifier trong cùng một câu.
  const pending = state
    ? await first(sql`
        DELETE FROM oauth_states WHERE state = ${state} AND expires_at > ${now()}
        RETURNING code_verifier`)
    : null;
  if (!pending || !code) return { ok: false, reason: "state_invalid" };

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: pending.code_verifier,
    }),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.id_token) {
    // Không ghi nội dung trả về (có thể chứa token); chỉ ghi mã lỗi của Google.
    throw new Error(
      `Google từ chối đổi mã đăng nhập (${response.status} ${tokens.error || ""}).`
    );
  }
  const payload = await verifyGoogleIdToken(tokens.id_token);
  return authorizeGoogleSignIn({
    email: payload.email || "",
    emailVerified: payload.email_verified === true,
    googleSub: payload.sub,
  });
}
