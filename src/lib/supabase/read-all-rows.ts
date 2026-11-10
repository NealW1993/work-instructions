interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Stops a backend that ignores paging from turning one page load into an endless loop. */
const MAX_PAGES = 2000;

/** Read in batches below PostgREST's row cap; callers must supply a stable order. */
export async function readAllRows<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const pageSize = 500;
  const rows: T[] = [];

  for (let offset = 0, page = 0; page < MAX_PAGES; page += 1) {
    const result = await readPage(offset, offset + pageSize - 1);
    if (result.error) {
      return { data: rows, error: result.error };
    }

    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length === 0) {
      return { data: rows, error: null };
    }
    // Projects may configure a server row cap smaller than our requested page.
    offset += batch.length;
  }

  return {
    data: rows,
    error: { message: `Stopped reading after ${MAX_PAGES} pages (${rows.length} rows) because the backend kept returning data. Check its paging configuration.` },
  };
}
