import { Traversable } from 'fp-ts/Array';
import { pipe } from 'fp-ts/function';
import { of as ofT } from 'fp-ts/Task';
import { ap, map, of, parFMap } from '../../fp';
import { singleThreadExecutor } from './singleThreadExecutor';

describe('singleThreadExecutor', () => {
  it('can execute map operations', async () => {
    const task = pipe(
      of(1),
      map(a => a + 2),
      map(a => a.toString()),
    );
    const run = singleThreadExecutor(task);
    expect(await run()).toEqual('3');
  });

  it('can execute ap operations', async () => {
    const task = pipe(
      of('hello'),
      map((prefix: string) => (x: number) => `${prefix}: ${x}`),
      ap(pipe(
        of(1),
        map(a => a + 1),
      )),
    );
    const run = singleThreadExecutor(task);
    expect(await run()).toEqual('hello: 2')
  });

  it('can execute parFMap operations', async () => {
    const task = pipe(
      of([1, 2, 3]),
      parFMap(Traversable)(n => ofT(n + 1)),
    );
    const run = singleThreadExecutor(task);
    expect(await run()).toEqual([2, 3, 4]);
  });

  it('can execute parFMap operations inside an ap operation', async () => {
    const task = pipe(
      of('hello'),
      map((prefix: string) => (x: number) => `${prefix}: ${x}`),
      ap(pipe(
        of([1, 2, 3]),
        parFMap(Traversable)(n => ofT(n + 1)),
        map(array => array.reduce((a, b) => a + b)),
      )),
    );
    const run = singleThreadExecutor(task);
    expect(await run()).toEqual('hello: 9');
  });

  it('runs parFMap tasks in order', async () => {
    const input = Array(1e4).fill(0).map((_, index) => index);
    const output = [];
    const task = pipe(
      of(Array(1e4).fill(0).map((_, index) => index)),
      parFMap(Traversable)((n) => {
        output.push(n);
        return ofT(n);
      }),
    );
    const run = singleThreadExecutor(task);
    await run();
    expect(output).toEqual(input);
  });

  // it('executes map operations stack safely', async () => {
  //   const task: MultitaskX<number> = {
  //     initial: 0,
  //     operations: Array(1e6).fill(makeMultitaskMap((x: number) => x + 1)),
  //   };
  //   const run = singleThreadExecutor(task);
  //   expect(await run()).toEqual(1e6);
  // });
  //
  // it('executes ap operations stack safely', async () => {
  //   const innerTask: MultitaskX<number> = {
  //     initial: 0,
  //     operations: Array(1e6).fill(
  //       makeMultitaskMap((x: number) => x + 1)
  //     ),
  //   };
  //   const task = pipe(
  //     of((n: number) => n.toString()),
  //     ap(innerTask)
  //   )
  //   const run = singleThreadExecutor(task);
  //   expect(await run()).toEqual(`${1e6}`);
  // });
});
