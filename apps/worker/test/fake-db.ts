import { randomUUID } from "node:crypto";
import type { Db } from "@le/db";

type Row = Record<string, unknown>;

interface Filter {
  kind: "eq" | "in" | "not-in" | "is" | "lt" | "lte" | "gte";
  column: string;
  value: unknown;
}

/**
 * An in-memory stand-in for the Supabase client, supporting the query shapes
 * the worker actually uses.
 *
 * It exists so the jobs can be exercised end to end. Everything else in this
 * repo is a unit test, which means the pieces are each correct and nothing
 * proves they fit together — and the places they meet (state transitions,
 * the reply gate, counters) are where a bug would send a real message to a real
 * person.
 *
 * It is not a Postgres emulator: no joins, no RLS, no constraint enforcement
 * beyond the unique keys declared below. Where it cannot be faithful it throws
 * rather than quietly returning something a real database never would.
 */
export class FakeDb {
  readonly tables = new Map<string, Row[]>();
  /** Unique keys enforced on insert/upsert, mirroring the migration. */
  private readonly uniqueKeys: Record<string, string[]> = {
    prospects: ["workspace_id", "linkedin_url"],
    campaign_prospects: ["campaign_id", "prospect_id"],
    linkedin_accounts: ["workspace_id", "user_id"],
    integrations: ["workspace_id", "kind", "user_id"],
    memberships: ["workspace_id", "user_id"],
    billing_events: ["id"],
  };

  seed(table: string, rows: Row[]): void {
    const existing = this.tables.get(table) ?? [];
    this.tables.set(
      table,
      existing.concat(rows.map((row) => ({ id: row.id ?? randomUUID(), created_at: new Date().toISOString(), ...row }))),
    );
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  find(table: string, match: Row): Row | undefined {
    return this.rows(table).find((row) => Object.entries(match).every(([k, v]) => row[k] === v));
  }

  /** Cast to the real client type; the worker only touches what is implemented. */
  asDb(): Db {
    return this as unknown as Db;
  }

  /**
   * The database functions the worker calls. Implemented synchronously between
   * awaits, which is what makes it a fair stand-in here: a read-and-write in
   * the worker interleaves under Promise.all and loses an increment, and this
   * does not — the same difference the real function makes in Postgres.
   */
  async rpc(name: string, args: Row): Promise<{ data: unknown; error: { message: string } | null }> {
    if (name !== "record_linkedin_action") {
      throw new Error(`fake-db has no implementation of ${name}()`);
    }
    const account = this.find("linkedin_accounts", { id: args.p_account_id as string });
    if (!account) return { data: [], error: null };

    const invite = args.p_kind === "invite" ? 1 : 0;
    const message = args.p_kind === "message" ? 1 : 0;
    account.invites_today = (account.invites_today as number) + invite;
    account.invites_this_week = (account.invites_this_week as number) + invite;
    account.messages_today = (account.messages_today as number) + message;
    account.last_action_at = new Date().toISOString();

    return {
      data: [
        {
          invites_today: account.invites_today,
          invites_this_week: account.invites_this_week,
          messages_today: account.messages_today,
        },
      ],
      error: null,
    };
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table, this.uniqueKeys[table]);
  }
}

class QueryBuilder implements PromiseLike<{ data: Row[] | null; error: null | { message: string } }> {
  private filters: Filter[] = [];
  private pending: { kind: "select" } | { kind: "insert" | "upsert" | "update"; payload: Row | Row[] } | { kind: "delete" } =
    { kind: "select" };
  private returning = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;
  private countMode: "exact" | null = null;
  private headOnly = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
    private readonly uniqueKey?: string[],
  ) {}

  select(columns?: string, options?: { count?: "exact"; head?: boolean }): this {
    // Columns are otherwise ignored — every row comes back whole, which is
    // harmless until someone writes an embedded join. PostgREST would return
    // the related row under that key; this would return the parent row without
    // it, and the caller would silently take the "no such record" branch. That
    // exact bug cost an afternoon, so it is now loud.
    if (columns && /\w\s*\(/.test(columns)) {
      throw new Error(
        `FakeDb: embedded joins are not supported (${this.table}.select("${columns}")). Select the foreign key and fetch the related rows separately.`,
      );
    }
    if (this.pending.kind === "select") this.pending = { kind: "select" };
    else this.returning = true;
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.pending = { kind: "insert", payload };
    return this;
  }

  upsert(payload: Row | Row[], _options?: { onConflict?: string }): this {
    this.pending = { kind: "upsert", payload };
    return this;
  }

  update(payload: Row): this {
    this.pending = { kind: "update", payload };
    return this;
  }

  delete(): this {
    this.pending = { kind: "delete" };
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, value: values });
    return this;
  }

  /** Only the `not("status", "in", "(a,b)")` form the worker uses. */
  not(column: string, operator: string, value: unknown): this {
    if (operator !== "in" && operator !== "is") {
      throw new Error(`FakeDb: unsupported not(${operator})`);
    }
    if (operator === "is") {
      this.filters.push({ kind: "is", column, value: value === null ? "not-null" : value });
      return this;
    }
    const list = String(value).replace(/^\(|\)$/g, "").split(",");
    this.filters.push({ kind: "not-in", column, value: list });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.limitTo = count;
    return this;
  }

  async single(): Promise<{ data: Row | null; error: null | { message: string } }> {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    if (!data || data.length !== 1) {
      return { data: null, error: { message: `expected exactly one row, got ${data?.length ?? 0}` } };
    }
    return { data: data[0]!, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null | { message: string } }> {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    return { data: data?.[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[] | null; error: null | { message: string } }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null | { message: string }; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<{ data: Row[] | null; error: null | { message: string }; count?: number }> {
    const all = this.db.tables.get(this.table) ?? [];
    if (!this.db.tables.has(this.table)) this.db.tables.set(this.table, all);

    if (this.pending.kind === "insert" || this.pending.kind === "upsert") {
      const incoming = (Array.isArray(this.pending.payload) ? this.pending.payload : [this.pending.payload]).map(
        (row) => ({ id: row.id ?? randomUUID(), created_at: new Date().toISOString(), ...row }),
      );
      const written: Row[] = [];

      for (const row of incoming) {
        const existing = this.uniqueKey
          ? all.find((candidate) => this.uniqueKey!.every((key) => candidate[key] === row[key]))
          : undefined;

        if (existing) {
          if (this.pending.kind === "insert") {
            return { data: null, error: { message: `duplicate key on ${this.table}` } };
          }
          Object.assign(existing, row, { id: existing.id });
          written.push(existing);
        } else {
          all.push(row);
          written.push(row);
        }
      }
      return { data: this.returning ? written : null, error: null };
    }

    const matched = all.filter((row) => this.filters.every((filter) => matches(row, filter)));

    if (this.pending.kind === "update") {
      for (const row of matched) Object.assign(row, this.pending.payload);
      return { data: this.returning ? matched : null, error: null };
    }

    if (this.pending.kind === "delete") {
      this.db.tables.set(this.table, all.filter((row) => !matched.includes(row)));
      return { data: null, error: null };
    }

    let result = [...matched];
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result.sort((a, b) => {
        const left = a[column] as string | number | null;
        const right = b[column] as string | number | null;
        if (left === right) return 0;
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;
        return (left < right ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.limitTo !== null) result = result.slice(0, this.limitTo);

    if (this.countMode) {
      return { data: this.headOnly ? null : result, error: null, count: matched.length };
    }
    return { data: result, error: null };
  }
}

function matches(row: Row, filter: Filter): boolean {
  const value = row[filter.column];
  switch (filter.kind) {
    case "eq":
      return value === filter.value;
    case "in":
      return (filter.value as unknown[]).includes(value);
    case "not-in":
      return !(filter.value as unknown[]).includes(value as string);
    case "is":
      return filter.value === "not-null" ? value !== null && value !== undefined : value === filter.value;
    case "lt":
      return value !== null && value !== undefined && String(value) < String(filter.value);
    case "lte":
      return value !== null && value !== undefined && String(value) <= String(filter.value);
    case "gte":
      return value !== null && value !== undefined && String(value) >= String(filter.value);
    default:
      return true;
  }
}
