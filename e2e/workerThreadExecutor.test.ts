import { Traversable } from 'fp-ts/Array';
import { pipe } from 'fp-ts/function';
import apOperationsResult from './testCases/apOperations';
import mapOperationsResult from './testCases/mapOperations';
import parFMapOperationsResult from './testCases/parFMapOperations';
import { getOrElse } from 'fp-ts/Option';
import * as path from 'path';
import parFMapLargeOperationResult from './testCases/parFMapLargeOperations';

describe('workerThreadExecutor', () => {
  it('can execute map operations', async () => {
    expect(await mapOperationsResult).toEqual('3');
  });

  it('can execute ap operations', async () => {
    expect(await apOperationsResult).toEqual('hello: 2');
  });

  it('can execute parFMap operations', async () => {
    expect(await parFMapOperationsResult).toEqual([4, 5, 6]);
  });

  it('can execute a highly parallel parFMap operation', async () => {
    expect(await parFMapLargeOperationResult).toEqual(Array(100).fill(3));
  });

  // it('can execute parFMap operations inside an ap operation', async () => {
  //   const task = pipe(
  //     of('hello'),
  //     map((prefix: string) => (x: number) => `${prefix}: ${x}`),
  //     ap(pipe(
  //       of([1, 2, 3]),
  //       parFMap(Traversable)(n => n + 1),
  //       map(array => array.reduce((a, b) => a + b)),
  //     )),
  //   );
  //   const run = workerThreadExecutor(task);
  //   expect(await run()).toEqual('hello: 9');
  // });
  //
  // it('runs parFMap tasks in order', async () => {
  //   const input = Array(1e5).fill(0).map((_, index) => index);
  //   const output = [];
  //   const task = pipe(
  //     of(Array(1e5).fill(0).map((_, index) => index)),
  //     parFMap(Traversable)((n) => {
  //       output.push(n);
  //       return n;
  //     }),
  //   );
  //   const run = workerThreadExecutor(task);
  //   await run();
  //   expect(output).toEqual(input);
  // });
  //
  // // it('executes map operations stack safely', async () => {
  // //   const task: MultitaskX<number> = {
  // //     initial: 0,
  // //     operations: Array(1e6).fill(makeMultitaskMap((x: number) => x + 1)),
  // //   };
  // //   const run = workerThreadExecutor(task);
  // //   expect(await run()).toEqual(1e6);
  // // });
  // //
  // // it('executes ap operations stack safely', async () => {
  // //   const innerTask: MultitaskX<number> = {
  // //     initial: 0,
  // //     operations: Array(1e6).fill(
  // //       makeMultitaskMap((x: number) => x + 1)
  // //     ),
  // //   };
  // //   const task = pipe(
  // //     of((n: number) => n.toString()),
  // //     ap(innerTask)
  // //   )
  // //   const run = workerThreadExecutor(task);
  // //   expect(await run()).toEqual(`${1e6}`);
  // // });
});
