import { pipe } from 'fp-ts/function';
import { getOrElse } from 'fp-ts/Option';
import { Task } from 'fp-ts/Task';
import { ap, map, of, workerThreadExecutor } from '../..';

const task = pipe(
  of('hello'),
  map((prefix: string) => (x: number) => `${prefix}: ${x}`),
  ap(pipe(
    of(1),
    map(a => a + 1),
  )),
);

const run: Task<any> = pipe(
  workerThreadExecutor(__filename, task),
  getOrElse(() => () => Promise.resolve('')),
);

const apOperationsResult = run();
export default apOperationsResult;
