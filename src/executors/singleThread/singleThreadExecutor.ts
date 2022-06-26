import { matchLeft } from 'fp-ts/Array';
import { Either, left, match as matchEither, right } from 'fp-ts/Either';
import { absurd, pipe, flow } from 'fp-ts/function';
import { ApplicativePar, Task, of as ofT, map as mapT } from 'fp-ts/Task';
import { Traversable1 } from 'fp-ts/Traversable';
import { Kind, URIS } from 'fp-ts/HKT';
import { map } from '../../fp';
import { MultitaskOperation, MultitaskX } from '../../model';
import { makeTuple } from '../../utils';
import { chainRec } from '../../utils/chainRecTask';

function runParFMap<URI extends URIS, A, B>(
  traversable: Traversable1<URI>,
  f: (value: A) => Task<B>,
  value: Kind<URI, A>,
): Task<Kind<URI, B>> {
  return traversable.sequence(ApplicativePar)(traversable.map(value, f));
}

const runStage = (value: any) => <A>(stage: MultitaskOperation<A>): Either<Task<A>, MultitaskX<A>> => {
  switch (stage._tag) {
    case 'MultitaskMap':
      return left(ofT(stage.f(value)));
    case 'MultitaskAp':
      return right(pipe(stage.f, map(x => x(value))));
    case 'MultitaskParFMap':
      return left(runParFMap(stage.traversable, stage.f, value));
    default:
      return absurd(stage);
  }
}

export const singleThreadExecutor = <A>(multitask: MultitaskX<A>): Task<A> => {
  return pipe(
    makeTuple(multitask.initial)(multitask.operations),
    chainRec<[any, MultitaskOperation<A>[]], A>(([value, remainingTasks]) => pipe(
      remainingTasks,
      matchLeft(
        () => ofT(right(value)),
        (nextTask, remainingT) => pipe(
          nextTask,
          runStage(value),
          matchEither(
            flow(mapT(newValue => makeTuple(newValue)(remainingT))),
            newMultitask => ofT(makeTuple(newMultitask.initial)([...newMultitask.operations, ...remainingT])),
          ),
          mapT(left),
        ),
      ),
    )),
  );
};
