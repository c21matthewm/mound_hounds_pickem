type QueryError = {
  message: string;
};

type QueryPage<T> = {
  data: T[] | null;
  error: QueryError | null;
};

const DEFAULT_PAGE_SIZE = 500;

export async function loadAllRows<T>(
  label: string,
  loadPage: (from: number, to: number) => PromiseLike<QueryPage<T>>,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) {
      throw new Error(`Failed to load ${label}: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}
