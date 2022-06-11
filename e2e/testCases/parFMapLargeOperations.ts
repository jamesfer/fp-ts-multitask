import { Traversable } from 'fp-ts/Array';
import { pipe } from 'fp-ts/function';
import { getOrElse } from 'fp-ts/Option';
import { Task } from 'fp-ts/Task';
import { map, of, parFMap, workerThreadExecutor } from '../..';

const task = pipe(
  of(Array(100).fill(0)),
  map(array => array.map(n => n + 1)),
  parFMap(Traversable)(n => n + 1),
  map(array => array.map(n => n + 1)),
);

const run: Task<any> = pipe(
  workerThreadExecutor(__filename, task),
  getOrElse(() => () => Promise.resolve([])),
);

const parFMapLargeOperationResult = run();
export default parFMapLargeOperationResult;
