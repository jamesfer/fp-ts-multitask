import { Traversable } from 'fp-ts/Array';
import { pipe } from 'fp-ts/function';
import { isSome } from 'fp-ts/Option';
import { workerThreadExecutor } from './executors/workerThreadExecutor';
import { map, of, parFMap } from './fp';

const multitask = pipe(
  of(1),
  map(a => a + 2),
  map(x => Array(4).fill(x)),
  parFMap(Traversable)(n => n ** 2),
);

const task = workerThreadExecutor(__filename, multitask);

if (isSome(task)) {
  task.value()
    .then(
      (result) => {
        console.log('Success!', result);
      },
      (error) => {
        console.error('Error!', error);
      }
    );
}

