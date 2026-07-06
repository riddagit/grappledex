// Split an array into fixed-size chunks. Used to keep single SQL statements under
// Postgres' parameter limit and Drizzle's query-builder recursion depth — passing
// tens of thousands of ids to one inArray/insert overflows the builder's stack.
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk: size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
