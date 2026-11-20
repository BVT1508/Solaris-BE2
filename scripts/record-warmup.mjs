// Ghi bản làm nóng src/warmup/fixture.js (xem src/warmup.js để biết nó dùng làm gì).
//
//   npm run warmup:record     chạy các request mẫu trên một SQLite tạm trong bộ nhớ, ghi kết quả từng truy vấn vào fixture.js
//   npm run warmup:check      ghi thử rồi so với fixture.js đang có; khác nhau (code đã đổi mà chưa ghi lại) thì thoát mã 1
//
// Chạy lại `warmup:record` mỗi khi sửa code làm đổi truy vấn của một đường có trong danh sách REQUESTS bên dưới, rồi commit
// fixture.js. Quên chạy thì không lỗi gì cho người dùng: đường đó chỉ bớt được làm nóng (và Worker ghi một dòng cảnh báo lúc
// khởi động). Script chỉ làm việc trên máy này: database là SQLite trong bộ nhớ, không gọi Cloudflare, không đọc .dev.vars.
//
// Mọi thứ tất định (đồng hồ đứng ở 0 như lúc Worker nạp module, số ngẫu nhiên là dãy cố định), nên ghi hai lần trên cùng
// một code cho ra đúng cùng một file.
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register("./warmup/hooks.mjs", import.meta.url);

// Đồng hồ đứng ở 0: lúc nạp module, Worker cũng thấy Date.now() là 0.
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(0);
  }
  static now() {
    return 0;
  }
};

const { default: app } = await import("../src/app.js");
const { dryFetch, sharedBytes } = await import("../src/warmup/dryRun.js");
const { runDry } = await import("../src/config/runtime.js");
const auth = await import("../src/services/authService.js");
const { env, query } = await import("./warmup/workers-stub.mjs");

const random = sharedBytes();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** Chạy một request dựng dữ liệu nền (không ghi lại); mã trạng thái phải đúng. */
const setup = async (expected, m, p, { h = {}, b } = {}) => {
  const status = await dryFetch(
    app,
    {
      m,
      p: `/api/v1${p}`,
      h,
      b: b === undefined ? undefined : JSON.stringify(b),
    },
    env.DB,
    random
  );
  if (status !== expected)
    fail(`Dựng dữ liệu nền hỏng ở ${m} ${p}: nhận ${status}, cần ${expected}.`);
};

// ---------- Dữ liệu nền: chủ hệ thống, một phiên, ba nhân viên, một đơn, một sản phẩm web, một link, ba góp ý ----------

const cookie = await runDry(
  { bindings: { DB: env.DB }, randomBytes: random },
  async () => {
    await auth.ensureOwner();
    const { member } = await auth.authorizeDevSignIn(env.OWNER_EMAIL);
    return `solaris_sid=${await auth.createSession(member.id, "warmup")}`;
  }
);
const member = { cookie };
const device = "warmup-device-0001";
const guest = { "x-device-id": device };

for (const name of ["an", "binh", "chi"]) {
  await setup(201, "POST", "/members", {
    h: member,
    b: {
      email: `${name}@warmup.invalid`,
      name: `Nhân viên ${name}`,
      role: "staff",
    },
  });
}
const staff = query(
  "SELECT id FROM members WHERE role = 'staff' ORDER BY email"
).map((row) => row.id);
await setup(201, "POST", "/orders", {
  h: member,
  b: {
    type: "web",
    title: "Website mẫu",
    client: { name: "Khách mẫu" },
    memberIds: [staff[0]],
  },
});
const orderId = query("SELECT id FROM orders")[0].id;
await setup(201, "POST", `/orders/${orderId}/deliverables`, {
  h: member,
  b: { type: "web", name: "Trang chủ", url: "https://vi-du.example" },
});
const deliverableId = query("SELECT id FROM deliverables")[0].id;
await setup(201, "POST", `/deliverables/${deliverableId}/share-links`, {
  h: member,
  b: { contactName: "Chị Hương" },
});
const token = query("SELECT token FROM share_links")[0].token;
for (let i = 0; i < 3; i += 1) {
  await setup(201, "POST", `/r/${token}/feedback`, {
    h: guest,
    b: {
      clientId: `warmup-setup-${i}`,
      authorName: "Chị Hương",
      body: `Góp ý mẫu ${i}`,
      mark: { kind: "pin", x: 0.2, y: 0.3 },
      anchor: { pageUrl: "/" },
    },
  });
}
const orderVersion = () =>
  query("SELECT version FROM orders WHERE id = ?", orderId)[0].version;

// ---------- Các request mẫu được làm nóng, theo thứ tự chạy ----------
// Đường đọc hay gặp nhất trước, rồi các đường ghi đắt nhất khi lạnh (đo trên Cloudflare thật, docs/kien-truc.md mục 10).
// Mỗi request mẫu tốn thời gian khởi động của Worker (trần 1 giây): thêm đường mới thì đo lại trước khi commit.
// Request sau thấy dữ liệu request trước đã ghi; "gửi vòng" phải đứng cuối vì nó đóng vòng của link.
const REQUESTS = [
  [200, "GET", "/auth/me", () => ({ h: member })],
  [200, "GET", "/orders", () => ({ h: member })],
  [200, "GET", `/orders/${orderId}`, () => ({ h: member })],
  [
    200,
    "GET",
    `/deliverables/${deliverableId}/feedback`,
    () => ({ h: member }),
  ],
  [200, "GET", `/r/${token}`, () => ({ h: guest })],
  [200, "GET", `/r/${token}/feedback`, () => ({ h: guest })],
  [
    201,
    "POST",
    `/r/${token}/feedback`,
    () => ({
      h: guest,
      b: {
        clientId: "warmup-guest",
        authorName: "Chị Hương",
        body: "Phóng to logo",
        mark: { kind: "region", x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
        anchor: {
          pageUrl: "/gioi-thieu",
          selector: "#main > div:nth-child(3)",
          viewport: { w: 1425, h: 900 },
          scroll: { x: 0, y: 320 },
          docSize: { w: 1425, h: 2380 },
        },
      },
    }),
  ],
  [
    201,
    "POST",
    `/deliverables/${deliverableId}/feedback`,
    () => ({
      h: member,
      b: {
        clientId: "warmup-team",
        body: "Căn lại khối bên phải",
        visibility: "customer",
        mark: { kind: "pin", x: 0.4, y: 0.6 },
        anchor: { pageUrl: "/thuc-don" },
      },
    }),
  ],
  [
    201,
    "POST",
    "/orders",
    () => ({
      h: member,
      b: {
        type: "web",
        title: "Đơn mẫu thứ hai",
        client: {
          name: "Khách mẫu thứ hai",
          contact: { name: "Anh Nam", phone: "0901234567" },
        },
        description: "Làm lại trang chủ",
        memberIds: [staff[0]],
        leaderIds: [staff[1]],
      },
    }),
  ],
  [
    200,
    "PUT",
    `/orders/${orderId}/members`,
    () => ({
      h: member,
      b: { version: orderVersion(), memberIds: [staff[0], staff[2]] },
    }),
  ],
  [
    201,
    "POST",
    "/members",
    () => ({
      h: member,
      b: {
        email: "moi@warmup.invalid",
        name: "Nhân viên mới",
        role: "staff",
        skills: [],
      },
    }),
  ],
  [
    201,
    "POST",
    `/deliverables/${deliverableId}/share-links`,
    () => ({ h: member, b: { contactName: "Anh Tuấn" } }),
  ],
  [200, "POST", `/r/${token}/submit`, () => ({ h: guest, b: {} })],
];

/** Bọc database tạm: chạy thật, đồng thời ghi lại kết quả của từng câu theo thứ tự (dạng mà replayDb phát lại). */
const recordingDb = (log) => {
  const one = async (run) => {
    try {
      const result = await run();
      log.push([result.results, result.meta.changes]);
      return result;
    } catch (err) {
      log.push({ e: err.message });
      throw err;
    }
  };
  const wrap = (inner) => ({
    inner,
    bind: (...params) => wrap(inner.bind(...params)),
    all: () => one(() => inner.all()),
    run: () => one(() => inner.run()),
    first: async () => (await one(() => inner.all())).results[0] ?? null,
  });
  return {
    prepare: (text) => wrap(env.DB.prepare(text)),
    async batch(statements) {
      try {
        const results = await env.DB.batch(
          statements.map((statement) => statement.inner)
        );
        log.push({
          b: results.map((result) => [result.results, result.meta.changes]),
        });
        return results;
      } catch (err) {
        log.push({ e: err.message });
        throw err;
      }
    },
  };
};

const requests = [];
for (const [expected, m, path, make] of REQUESTS) {
  const { h, b } = make();
  const entry = {
    m,
    p: `/api/v1${path}`,
    h,
    b: b === undefined ? undefined : JSON.stringify(b),
  };
  const log = [];
  const status = await dryFetch(app, entry, recordingDb(log));
  if (status !== expected)
    fail(
      `Request mẫu ${m} ${path} trả ${status}, cần ${expected}. Sửa danh sách REQUESTS hoặc dữ liệu nền.`
    );
  requests.push({ ...entry, s: status, r: log });
}

// JSON.parse của một chuỗi nhanh hơn để máy ảo phân tích một object lớn viết thẳng. Chuỗi nháy đơn: thoát \ và '.
const json = JSON.stringify({ requests })
  .replace(/\\/g, "\\\\")
  .replace(/'/g, "\\'");
const content = `// File sinh tự động bởi \`npm run warmup:record\` (scripts/record-warmup.mjs). KHÔNG sửa tay.
// Các request mẫu để làm nóng lúc nạp module và kết quả truy vấn đã ghi của chúng: xem src/warmup.js.
// Dữ liệu ở đây là dữ liệu giả sinh trên một database tạm; cookie và token bên trong không có giá trị ở bất cứ đâu.
// prettier-ignore
export default JSON.parse('${json}');
`;

const target = fileURLToPath(
  new URL("../src/warmup/fixture.js", import.meta.url)
);
const queries = requests.reduce((sum, entry) => sum + entry.r.length, 0);
const summary = `${requests.length} request mẫu, ${queries} lượt truy vấn, ${Math.round(content.length / 1024)} KB`;

if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content) {
    fail(
      "src/warmup/fixture.js đã cũ so với code hiện tại. Chạy `npm run warmup:record` rồi commit file đó."
    );
  }
  console.log(`Bản làm nóng khớp với code hiện tại (${summary}).`);
} else {
  writeFileSync(target, content);
  console.log(`Đã ghi src/warmup/fixture.js: ${summary}.`);
}
process.exit(0);
