// Bản giả của "cloudflare:workers" cho scripts/record-warmup.mjs. Database là SQLite trong bộ nhớ (node:sqlite) với đủ
// migration của repo, bọc theo giao diện của D1 (prepare, bind, all, run, first, batch). Không nối tới Cloudflare.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const migrations = fileURLToPath(new URL("../../migrations/", import.meta.url));
const sqlite = new DatabaseSync(":memory:");
for (const file of readdirSync(migrations).sort()) {
  sqlite.exec(readFileSync(migrations + file, "utf8"));
}

/** Chạy thẳng một câu SQL trên database tạm (cho script ghi đọc lại id vừa tạo). */
export const query = (text, ...params) => sqlite.prepare(text).all(...params);

const d1Error = (err) => new Error(`D1_ERROR: ${err.message}: SQLITE_ERROR`);

class Statement {
  constructor(text, params = []) {
    this.text = text;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.text, params);
  }
  execute() {
    const statement = sqlite.prepare(this.text);
    const writes = /\b(INSERT|UPDATE|DELETE)\b/i.test(this.text);
    if (!writes || /\bRETURNING\b/i.test(this.text)) {
      const results = statement.all(...this.params).map((row) => ({ ...row }));
      return {
        success: true,
        results,
        meta: { changes: writes ? results.length : 0 },
      };
    }
    const { changes } = statement.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(changes) } };
  }
  async all() {
    try {
      return this.execute();
    } catch (err) {
      throw d1Error(err);
    }
  }
  run() {
    return this.all();
  }
  async first() {
    return (await this.all()).results[0] ?? null;
  }
}

const DB = {
  prepare: (text) => new Statement(text),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw d1Error(err);
    }
  },
};

export const env = {
  DB,
  // Như bản deploy: không có đăng nhập dev, mọi bộ giới hạn tần suất đều được gọi.
  ENVIRONMENT: "production",
  OWNER_EMAIL: "owner@warmup.invalid",
  CLIENT_ORIGINS: "https://warmup.invalid",
  SESSION_HOURS: "12",
  LOG_LEVEL: "silent",
};

export const waitUntil = (promise) => {
  Promise.resolve(promise).catch(() => {});
};

export class DurableObject {
  constructor(ctx, environment) {
    this.ctx = ctx;
    this.env = environment;
  }
}
