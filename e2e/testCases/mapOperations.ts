import { pipe } from 'fp-ts/function';
import { getOrElse } from 'fp-ts/Option';
import { Task } from 'fp-ts/Task';
import { map, of, workerThreadExecutor } from '../..';

const task = pipe(
  of(1),
  map(a => a + 2),
  map(a => a.toString()),
);

const run: Task<any> = pipe(
  workerThreadExecutor(__filename, task),
  getOrElse(() => () => Promise.resolve('')),
);

const mapOperationsResult = run();
export default mapOperationsResult;
