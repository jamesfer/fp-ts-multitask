import { Traversable } from 'fp-ts/Array';
import { pipe } from 'fp-ts/function';
import { getOrElse } from 'fp-ts/Option';
import { Task } from 'fp-ts/Task';
import { of, parFMap } from '../../src/fp';
import { workerThreadExecutor } from '../../src/executors/workerThread/workerThreadExecutor';

const task = pipe(
  of([1, 2, 3]),
  parFMap(Traversable)(n => n + 1),
);

const run: Task<any> = pipe(
  workerThreadExecutor(__filename, task),
  getOrElse(() => () => Promise.resolve([])),
);

const parFMapOperationsResult = run();
export default parFMapOperationsResult;
