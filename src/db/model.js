import { sql } from "./d1.js";

/**
 * Khai báo một bảng: tên thuộc tính trong code (camelCase, như document Mongoose cũ) ứng với cột nào (snake_case),
 * và cột nào là JSON hay boolean. Không phải ORM: chỉ đổi tên, đổi kiểu, và dựng sẵn mảnh SQL cho INSERT và UPDATE.
 *
 *   const Member = defineModel("members", { id: "id", orgId: "org_id", skills: json("skills"), paused: bool("paused") });
 *
 *   Member.fromRow(row)        dòng D1 thành object { id, orgId, skills: [...], paused: true }
 *   Member.insert(object)      mảnh sql INSERT đủ các thuộc tính được truyền (undefined thì bỏ qua, để cột lấy DEFAULT)
 *   Member.set(changes)        mảnh sql "name = ?, role = ?" cho câu UPDATE
 *   Member.col("orgId")        tên cột, khi cần dựng điều kiện động
 *
 * Giá trị truyền cho insert và set có thể là một mảnh sql (truy vấn con, biểu thức) thay cho dữ liệu:
 *   Feedback.insert({ ..., seq: sql`(SELECT feedback_seq FROM deliverables WHERE id = ${deliverableId})` })
 */
export const json = (column) => ({ column, type: "json" });
export const bool = (column) => ({ column, type: "bool" });

export function defineModel(table, fields) {
  const defs = Object.entries(fields).map(([prop, def]) =>
    typeof def === "string"
      ? { prop, column: def, type: "plain" }
      : { prop, column: def.column, type: def.type }
  );
  const byProp = new Map(defs.map((def) => [def.prop, def]));

  const decode = (def, value) => {
    if (value === null || value === undefined) return null;
    if (def.type === "json") return JSON.parse(value);
    if (def.type === "bool") return value === 1;
    return value;
  };

  const encode = (def, value) => {
    // Mảnh sql thì ghép nguyên, ví dụ seq: sql`(SELECT feedback_seq FROM deliverables WHERE id = ${id})`.
    if (sql.is(value)) return value;
    if (value === null || value === undefined) return null;
    if (def.type === "json") return JSON.stringify(value);
    if (def.type === "bool") return value ? 1 : 0;
    return value;
  };

  const defOf = (prop) => {
    const def = byProp.get(prop);
    if (!def) throw new Error(`Bảng ${table} không có thuộc tính ${prop}.`);
    return def;
  };

  return {
    table,

    fromRow(row) {
      if (!row) return null;
      const out = {};
      for (const def of defs) {
        if (def.column in row) out[def.prop] = decode(def, row[def.column]);
      }
      return out;
    },

    col: (prop) => defOf(prop).column,

    insert(object) {
      const used = defs.filter((def) => object[def.prop] !== undefined);
      const columns = sql.raw(used.map((def) => def.column).join(", "));
      const values = sql.join(
        used.map((def) => sql`${encode(def, object[def.prop])}`)
      );
      return sql`INSERT INTO ${sql.raw(table)} (${columns}) VALUES (${values})`;
    },

    set(changes) {
      const parts = Object.entries(changes)
        .filter(([, value]) => value !== undefined)
        .map(([prop, value]) => {
          const def = defOf(prop);
          return sql`${sql.raw(def.column)} = ${encode(def, value)}`;
        });
      if (parts.length === 0) {
        throw new Error(`Không có trường nào để cập nhật bảng ${table}.`);
      }
      return sql.join(parts);
    },
  };
}
