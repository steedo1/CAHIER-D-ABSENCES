type ReadError = { message: string };
type ReadResult<Row> = { data: Row[] | null; error: ReadError | null };
type PagedQuery<Row> = {
  order(column: string, options: { ascending: boolean }): {
    range(from: number, to: number): PromiseLike<ReadResult<Row>>;
  };
};

// Keep pages below PostgREST's default 1,000-row response limit. Rebuild the
// query each time so ranges and ordering do not accumulate on a mutable builder.
export async function readAllTextbookRows<Row = Record<string, unknown>>(
  buildQuery: () => PagedQuery<Row>,
): Promise<ReadResult<Row>> {
  const pageSize = 500;
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery()
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    // Never turn a failed later page into an apparently complete progress rate.
    if (error) return { data: null, error };
    const page = data || [];
    for (const row of page) {
      const id = String((row as { id?: unknown }).id || "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      rows.push(row);
    }
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
