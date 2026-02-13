export function makeGeminiPayload(parts: Array<Record<string, unknown>>, groundingMetadata?: Record<string, unknown>) {
  const candidate: Record<string, unknown> = {
    content: { parts },
  };
  if (groundingMetadata) {
    candidate.groundingMetadata = groundingMetadata;
  }
  return { candidates: [candidate] };
}

export function sseFromPayload(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function streamFromStrings(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

export async function readObjectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const items: T[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) items.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
  return items;
}

type SupabaseQueryState = {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
};

export function createSupabaseMock(tables: Record<string, unknown> = {}) {
  const resolveTable = (table: string, state: SupabaseQueryState): { data: any; error: any } => {
    const tableData = tables[table];
    const data = typeof tableData === 'function' ? tableData(state) : tableData;
    if (Array.isArray(data)) return { data, error: null };
    if (data === undefined) return { data: [], error: null };
    return { data: [data], error: null };
  };

  const pickSingle = (table: string, state: SupabaseQueryState): { data: any; error: any } => {
    const tableData = tables[table];
    const data = typeof tableData === 'function' ? tableData(state) : tableData;
    if (Array.isArray(data)) return { data: data[0] ?? null, error: null };
    if (data === undefined) return { data: null, error: null };
    return { data, error: null };
  };

  return {
    from(table: string) {
      const state: SupabaseQueryState = { table, filters: [] };
      const builder: any = {
        select() { return builder; },
        gte(column: string, value: unknown) { state.filters.push({ op: 'gte', column, value }); return builder; },
        lte(column: string, value: unknown) { state.filters.push({ op: 'lte', column, value }); return builder; },
        order() { return builder; },
        limit() { return builder; },
        eq(column: string, value: unknown) { state.filters.push({ op: 'eq', column, value }); return builder; },
        in(column: string, value: unknown) { state.filters.push({ op: 'in', column, value }); return builder; },
        or() { return builder; },
        ilike(column: string, value: unknown) { state.filters.push({ op: 'ilike', column, value }); return builder; },
        maybeSingle() { return Promise.resolve(pickSingle(table, state)); },
        insert(rows: unknown) { return Promise.resolve({ data: rows, error: null }); },
        upsert(rows: unknown) { return Promise.resolve({ data: rows, error: null }); },
        update(rows: unknown) {
          return {
            eq() { return Promise.resolve({ data: rows, error: null }); },
          };
        },
        then(onFulfilled: (value: any) => any, onRejected?: (reason: any) => any) {
          return Promise.resolve(resolveTable(table, state)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}
