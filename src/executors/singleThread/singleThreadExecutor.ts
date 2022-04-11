import { matchLeft } from 'fp-ts/Array';
import { tailRec } from 'fp-ts/ChainRec';
import { Either, left, right, match as matchEither } from 'fp-ts/Either';
import { absurd, flow, pipe } from 'fp-ts/function';
import { fromArray, unprepend } from 'fp-ts/NonEmptyArray';
import { fold, fold as foldO, none, Option, some } from 'fp-ts/Option';
import { mapFst, mapSnd } from 'fp-ts/Tuple';
import { map } from '../../fp';
import { Multitask, MultitaskOperation, MultitaskX } from '../../model';
import { makeTuple } from '../../utils';

// function runInitialStage<A>(stage: MultitaskOperation<A>): A {
//   if (stage._tag === 'MultitaskPure') {
//     return stage.value;
//   }
//
//   throw new Error(`Cannot run ${stage._tag} stage with no previous value`);
// }

const runStage = (value: any) => <A>(stage: MultitaskOperation<A>): Either<A, MultitaskX<A>> => {
  switch (stage._tag) {
    case 'MultitaskMap':
      return left(stage.f(value));
    case 'MultitaskAp':
      return right(pipe(stage.f, map(x => x(value))));
    case 'MultitaskParFMap':
      return left(stage.traversable.map(value, stage.f));
    default:
      return absurd(stage);
  }
}

// const applyStage = (maybeValue: Option<any>) => <A>(
//   head: MultitaskOperation<A>,
// ): A => {
//   return pipe(
//     maybeValue,
//     fold(
//       () => runInitialStage(head),
//       runStage(head),
//     ),
//   );
// }

export const singleThreadExecutor = <A>(multitask: MultitaskX<A>) => async (): Promise<A> => {
  return tailRec(
    makeTuple<any>(multitask.initial)(multitask.operations),
    ([value, remainingTasks]): Either<[any, MultitaskOperation<A>[]], A> => pipe(
      remainingTasks,
      matchLeft(
        () => right(value),
        (nextTask, remainingT) => pipe(
          nextTask,
          runStage(value),
          matchEither(
            nextValue => makeTuple(nextValue)(remainingT),
            newMultitask => makeTuple(newMultitask.initial)([...newMultitask.operations, ...remainingT]),
          ),
          left,
        ),
      ),
    ),
  );
};
