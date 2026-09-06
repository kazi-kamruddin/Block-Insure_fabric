export async function withBoundedRetry(operation, options = {}) {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maximumDelayMs = options.maximumDelayMs ?? 5_000;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await delay(Math.min(baseDelayMs * (2 ** (attempt - 1)), maximumDelayMs));
    }
  }
  throw lastError;
}
