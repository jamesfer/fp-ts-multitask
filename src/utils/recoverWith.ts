import { mapLeft, toUnion } from 'fp-ts/Either';
import { flow, pipe } from 'fp-ts/function';
import { Task, map } from 'fp-ts/Task';
import { TaskEither } from 'fp-ts/TaskEither';

export function recoverWith<E, A>(f: (e: E) => A): (taskEither: TaskEither<E, A>) => Task<A> {
  return flow(
    map(flow(mapLeft(f), toUnion)),
  );
}
