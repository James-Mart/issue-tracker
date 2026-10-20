/**
 * Wait until every task settles. Throws the first rejection, and returns
 * the defined results from the tasks that produced a value.
 */
export async function settledValues<T>(
  tasks: readonly Promise<T | undefined>[],
): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
  return results.flatMap((result) =>
    result.status === "fulfilled" && result.value !== undefined ? [result.value] : [],
  );
}
