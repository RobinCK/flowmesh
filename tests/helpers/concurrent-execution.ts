export async function executeConcurrently<T>(
  count: number,
  fn: (index: number) => Promise<T>
): Promise<Array<{ index: number; result?: T; error?: Error }>> {
  const promises = Array.from({ length: count }, (_, i) =>
    fn(i)
      .then(result => ({ index: i, result }))
      .catch(error => ({ index: i, error }))
  );
  return Promise.all(promises);
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
