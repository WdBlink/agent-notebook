export function createTerminalOperationQueue(onError: (error: unknown) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  let resizeBarrierError: unknown;

  const append = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch((error: unknown) => { onError(error); });
    return result;
  };

  return {
    enqueueResize<T>(operation: () => Promise<T>): Promise<T> {
      const result = append(operation);
      void result.then(
        () => { resizeBarrierError = undefined; },
        (error: unknown) => { resizeBarrierError = error; }
      );
      return result;
    },
    enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
      return append(async () => {
        if (resizeBarrierError !== undefined) throw resizeBarrierError;
        return operation();
      });
    },
    reset(): void {
      resizeBarrierError = undefined;
    }
  };
}
