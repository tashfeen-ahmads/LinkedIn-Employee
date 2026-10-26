/**
 * A recording stand-in for the Supabase query builder, for the few web tests
 * that run a route or a lib function as written.
 *
 * It does not filter anything. Every query is recorded with its table, its
 * operation, its payload and its filters, and `respond` decides what comes
 * back — so a test states exactly what the database said and then asserts on
 * exactly what was written.
 */
export interface FakeCall {
  table: string;
  op: "select" | "update" | "insert" | "upsert" | "delete";
  payload?: unknown;
  columns?: string;
  filters: Array<[string, string, unknown]>;
  single: boolean;
}

export type FakeResult = { data?: unknown; error?: unknown; count?: number } | undefined;

export function fakeSupabase(respond: (call: FakeCall) => FakeResult, userId = "user-1") {
  const calls: FakeCall[] = [];
  const from = (table: string) => {
    const call: FakeCall = { table, op: "select", filters: [], single: false };
    const run = () => {
      calls.push(call);
      const result = respond(call) ?? {};
      return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
    };
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (col: string, a?: unknown, b?: unknown) => {
      call.filters.push([name, col, b === undefined ? a : [a, b]]);
      return builder;
    };
    Object.assign(builder, {
      select(columns?: string) {
        if (call.op === "select") call.columns = columns;
        return builder;
      },
      update(payload: unknown) {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
      insert(payload: unknown) {
        call.op = "insert";
        call.payload = payload;
        return builder;
      },
      upsert(payload: unknown) {
        call.op = "upsert";
        call.payload = payload;
        return builder;
      },
      delete() {
        call.op = "delete";
        return builder;
      },
      eq: chain("eq"),
      neq: chain("neq"),
      in: chain("in"),
      is: chain("is"),
      not: chain("not"),
      gte: chain("gte"),
      lte: chain("lte"),
      order: () => builder,
      limit: () => builder,
      maybeSingle() {
        call.single = true;
        return Promise.resolve(run());
      },
      single() {
        call.single = true;
        return Promise.resolve(run());
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    });
    return builder;
  };
  const client = {
    from,
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "rep@example.com" } } }) },
  };
  return { calls, client };
}

/** The value a call filtered `col` by with `eq`, if it did. */
export function eqOf(call: FakeCall, col: string): unknown {
  return call.filters.find(([name, c]) => name === "eq" && c === col)?.[2];
}
