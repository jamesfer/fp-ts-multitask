import { Traversable } from 'fp-ts/Array';
import { pipe } from 'fp-ts/function';
import { Task, map as mapT } from 'fp-ts/Task';
import { of, parFMap, workerThreadExecutor } from '../..';
import { threadId } from 'worker_threads';
import { getOrElse } from 'fp-ts/Option';

/**
 * Uses the Atomics library to block the current thread for a certain time
 * @param milliseconds
 */
// function atomicSleep(milliseconds: number) {
//   const sharedArrayBuffer = new SharedArrayBuffer(4);
//   const int32Array = new Int32Array(sharedArrayBuffer);
//   Atomics.wait(int32Array, 0, 0, milliseconds);
// }

const task = pipe(
  of(Array(10).fill(0) as number[]),
  parFMap(Traversable)(_ => async () => threadId),
);

const run: Task<any> = pipe(
  workerThreadExecutor(__filename, task),
  mapT(getOrElse(() => [])),
);

const parFMapThreadOperationsResult = run();
export default parFMapThreadOperationsResult;
