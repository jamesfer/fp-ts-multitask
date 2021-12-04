import { lookup, matchLeft, matchRight } from 'fp-ts/Array';
import { tailRec } from 'fp-ts/ChainRec';
import { Either, isLeft, left, match as matchE, right } from 'fp-ts/Either';
import { absurd, pipe } from 'fp-ts/function';
import { Kind, URIS } from 'fp-ts/HKT';
import { fromArray, matchLeft as matchLeftNea, NonEmptyArray, of } from 'fp-ts/NonEmptyArray';
import { fold as foldO, match as matchO, none, Option, some } from 'fp-ts/Option';
import { map as mapT, of as ofT, Task } from 'fp-ts/Task';
import { ApplicativePar, tryCatch } from 'fp-ts/TaskEither';
import { Traversable1 } from 'fp-ts/Traversable';
import { isMainThread, parentPort, Worker, workerData } from 'worker_threads';
import { MultitaskPointer } from '../index';
import { Multitask, MultitaskOperation, MultitaskX } from '../model';
import { makeTriple, makeTuple } from '../utils';
import { chainRec } from '../utils/chainRecTask';
import { recoverWith } from '../utils/recoverWith';

function runWorker(filename: string, workerData: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(filename, { workerData });
    worker.on('error', reject);
    worker.on('message', (either) => {
      if (isLeft(either)) {
        reject(either.left);
      } else {
        resolve(either.right);
      }
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

const runParFMap = <U extends URIS, A>(
  traversable: Traversable1<U>,
  filename: string,
  wrappedValue: Kind<U, any>,
  state: NonEmptyArray<[number, any]>,
): Task<Kind<U, A>> => {
  return pipe(
    traversable.traverse(ApplicativePar)(wrappedValue, (value) => {
      const multitaskPointer: MultitaskPointer = { state, value };
      return tryCatch(
        () => runWorker(filename, multitaskPointer),
        (reason: any) => reason instanceof Error ? reason : new Error(reason),
      );
    }),
    recoverWith<Error, any>((error) => {
      throw error;
    }),
  );
}

// const runStage = <A>(
//   filename: string,
//   value: any,
//   cursor: number[],
// ) => (
//   stage: MultitaskOperation<A>,
// ): Task<[A, Option<MultitaskX<any>>]> => {
//   switch (stage._tag) {
//     // case 'MultitaskChain':
//     //   return ofT(makeTuple(none)(stage.f(input)));
//     // case 'MultitaskPure':
//     //   return ofT(makeTuple(some(stage.value))([]));
//     case 'MultitaskMap':
//       return ofT(makeTuple(stage.f(value))(none));
//     case 'MultitaskAp':
//       return ofT(makeTuple(value)());
//     case 'MultitaskParFMap': {
//       return pipe(
//         runParTraverseChain(stage.traversable, filename, value, index),
//         mapT((result: A)  => makeTuple(some(result))([])),
//       );
//     }
//     default:
//       return absurd(stage);
//   }
// }

// const applyStage = (filename: string, maybeValue: Option<any>, index: number) => <A>(
//   [head, tail]: [MultitaskOperation<A>, MultitaskOperation<any>[]],
// ): TaskEither<Error, [Option<A>, MultitaskOperation<any>[]]> => {
//   return pipe(
//     maybeValue,
//     fold(
//       () => ofT(makeTuple(runInitialStage(head))(tail)),
//       flow(
//         runStage(filename, head, index),
//         mapT(mapSnd(newStages => [...newStages, ...tail])),
//       ),
//     ),
//   );
// }

// interface State {
//   cursor: number;
//   operations: MultitaskOperation<any>[],
//   parent: Option<State>;
// }
//
// function getCursor(state: State): NonEmptyArray<number> {
//   return tailRec(
//     makeTuple(state.parent)(of(state.cursor)),
//     ([maybeParent, cursor]) => pipe(
//       maybeParent,
//       foldO(
//         () => right(cursor),
//         parent => pipe(
//           cursor,
//           append(parent.cursor),
//           makeTuple(parent.parent),
//           left,
//         ),
//       ),
//     ),
//   );
// }

const lookupTask2 = <A>(
  filename: string,
  multitask: MultitaskX<A>,
) => (
  state: NonEmptyArray<[number, any]>,
): Option<MultitaskOperation<any>> => {
  return pipe(
    state,
    matchLeftNea(([headOffset, value], tailState) => pipe(
      multitask.operations,
      lookup(headOffset),
      // mapO(task => ),
    )),
  );
}

const runTask2 = <A>(
  filename: string,
  multitask: MultitaskX<A>,
) => (
  state: NonEmptyArray<[number, any]>,
): Task<Either<NonEmptyArray<[number, any]>, A>> => {
  tailRec<[MultitaskX<A>, NonEmptyArray<[number, any]>], Task<Either<NonEmptyArray<[number, any]>, A>>>(
    makeTuple(multitask)(state),
    ([multitask, state]) => pipe(
      state,
      matchLeftNea(([headOffset, value], tailState) => pipe(
        multitask.operations,
        lookup(headOffset),
        matchO(
          // Offset index is at the end of the task so we are done
          () => right(ofT(right(value))),
          (task) => {

          },
        )
      )),
    ),
  );

  switch (task._tag) {
    case 'MultitaskMap':
      return ofT(left(of(makeTuple(headOffset + 1)(task.f(value)))));

    case 'MultitaskAp':
      return pipe(
        tailState,
        fromArray,
        matchO(
          // Tail state is empty, start processing the nested Multitask by appending a cursor
          () => ofT(left([makeTuple(headOffset)(value), makeTuple(0)(task.f.initial)])),
          // Tail state has an offset
          (nonEmptyTailState) => pipe(
            lookupTask2(filename, task.f)(nonEmptyTailState),
            mapT(matchE(
              // Nested task was not finished
              (x) => left([makeTuple(headOffset)(value), ...x]),
              // Nested task finished
              (resultFunction) => left(of(makeTuple(headOffset + 1)(resultFunction(value)))),
            )),
          ),
        ),
      );

    case 'MultitaskParFMap':
      return pipe(
        runParFMap(task.traversable, filename, value, rootState),
        mapT(nextValue => left(of(makeTuple(headOffset + 1)(nextValue)))),
      );

    default:
      return absurd(task);
  }
}

interface TaskState {
  offset: number;
  value: any;
  nestedState: Option<Either<TaskState, any>>;
}

type State = { offset: number, value: any };
type X = NonEmptyArray<Either<State, any>>;

const lookupTask3 = <A>(
  filename: string,
  multitask: MultitaskX<A>,
) => (
  state: X,
): Task<Either<X, A>> => {
  // const l: Task<Either<NonEmptyArray<Either<[number, any], any>>, A>>

  return pipe(
    makeTuple<State[]>([])(state),
    chainRec<[State[], X], Either<X, A>>(([parentStates, states]) => pipe(
      states,
      matchLeftNea((headState, tailStates) => pipe(
        headState,
        matchE(
          // Valid state, continue processing
          (currentState): Task<Either<[State[], X], Either<X, A>>> => {
            pipe(
              multitask.operations,
              lookup(currentState.offset),
              matchO(
                // Offset index is at the end of the task so we are done on this level
                () => ofT(left(parentStates)),

              ),
            );
          },
          // State level complete
          (value) => pipe(
            parentStates,
            matchRight(
              // There are no more parents, so we are done this iteration
              () => right(value),
              (superParents, parent) => left(makeTuple(superParents)<X>([left(parent), right(value)])),
            ),
            ofT
          )
        ),
      )),
    ))
  )

  tailRec(makeTuple<State[]>([])(state), ([parentStates, states]) => pipe(
    states,
    matchLeftNea((headState, tailStates) => pipe(
      headState,
      matchE(
        // Valid state, continue processing
        (): Task<Either<[State[], X], Either<X, A>>> => {

        },
        // State level complete, return to processing a parent
        (value) => pipe(
          parentStates,
          matchRight(
            // There are no more parents, so we are done this step
            () => right(value),
            (grandParents, parent) => left(makeTuple(grandParents)<X>([left(parent), right(value)])),
          ),
          ofT
        )
      ),
    )),
  ));

  const x = pipe(
    multitask.operations,
    lookup(state.offset),
    matchO(
      // Offset index is at the end of the task so we are done
      () => ofT(right(state.value)),
      (task): Task<Either<TaskState, A>> => {
        switch (task._tag) {
          case 'MultitaskMap':
            return ofT(left({ offset: state.offset + 1, value: task.f(state.value), nestedState: none }));

          case 'MultitaskAp':
            return pipe(
              state.nestedState,
              fromArray,
              matchO(
                // Tail state is empty, start processing the nested Multitask by appending a cursor
                () => ofT(left([makeTuple(offset)(value), makeTuple(0)(task.f.initial)])),
                // Tail state has an offset
                (nonEmptyTailState) => pipe(
                  lookupTask(filename, task.f)(nonEmptyTailState),
                  mapT(matchE(
                    // Nested task was not finished
                    (x) => left([makeTuple(offset)(value), ...x]),
                    // Nested task finished
                    (resultFunction) => left(of(makeTuple(offset + 1)(
                      resultFunction(value)))),
                  )),
                ),
              ),
            );

          case 'MultitaskParFMap':
            return pipe(
              runParFMap(task.traversable, filename, value, state),
              mapT(nextValue => left(of(makeTuple(offset + 1)(nextValue)))),
            );

          default:
            return absurd(task);
        }
      },
    )
  );
}


const lookupTask = <A>(
  filename: string,
  multitask: MultitaskX<A>,
) => (
  state: NonEmptyArray<[number, any]>,
): Task<Either<NonEmptyArray<[number, any]>, A>> => {
  // const l: Task<Either<NonEmptyArray<Either<[number, any], any>>, A>>

  return pipe(
    state,
    matchLeftNea(([headOffset, value], tailState) => pipe(
      multitask.operations,
      lookup(headOffset),
      matchO(
        // Offset index is at the end of the task so we are done
        () => ofT(right(value)),
        (task) => {
          switch (task._tag) {
            case 'MultitaskMap':
              return ofT(left(of(makeTuple(headOffset + 1)(task.f(value)))));

            case 'MultitaskAp':
              return pipe(
                tailState,
                fromArray,
                matchO(
                  // Tail state is empty, start processing the nested Multitask by appending a cursor
                  () => ofT(left([makeTuple(headOffset)(value), makeTuple(0)(task.f.initial)])),
                  // Tail state has an offset
                  (nonEmptyTailState) => pipe(
                    lookupTask(filename, task.f)(nonEmptyTailState),
                    mapT(matchE(
                      // Nested task was not finished
                      (x) => left([makeTuple(headOffset)(value), ...x]),
                      // Nested task finished
                      (resultFunction) => left(of(makeTuple(headOffset + 1)(
                        resultFunction(value)))),
                    )),
                  ),
                ),
              );

            case 'MultitaskParFMap':
              return pipe(
                runParFMap(task.traversable, filename, value, state),
                mapT(nextValue => left(of(makeTuple(headOffset + 1)(nextValue)))),
              );

            default:
              return absurd(task);
          }
        },
      )
    )),
  );
}

function executeTaskAsMainThread<A, B>(filename: string, multitask: MultitaskX<A>): Task<A> {
  return pipe(
    makeTriple<any>(multitask.initial)(multitask.operations)(0),
    chainRec(([value, remainingTasks, index]) => pipe(
      remainingTasks,
      matchLeft(() => right(value), (nextTask, remainingT) => pipe(
        nextTask,
        runStage(filename, value, index),
        mapT(([nextValue, tail]) => pipe(
          tail,
          fromArray,
          foldO(
            () => right(nextValue),
            nonEmptyTail => left(makeTriple(nextValue)(nonEmptyTail)(index + 1)),
          ),
        )),
      )),
      recoverWith((error): never => {
        throw error;
      }),
    )),
  );
}

function isMultitaskResult(a: any): a is MultitaskPointer {
  return a && typeof a === 'object' && typeof a['stageIndex'] === 'number' && 'value' in a;
}

function executeTaskAsWorker<A>(task: Multitask<any>): A {
  const multitaskResult = workerData;
  if (!isMultitaskResult(multitaskResult)) {
    const dataString = JSON.stringify(multitaskResult, undefined, 2);
    throw new Error(`Failed to decode worker data into a MultitaskResult: ${dataString}`);
  }

  if (multitaskResult.stageIndex >= task.length) {
    throw new Error(`Stage index of ${multitaskResult.stageIndex} is out of bounds for task length ${task.length}`);
  }

  const stage: MultitaskOperation<A> = task[multitaskResult.stageIndex];
  if (stage._tag === 'MultitaskParFMap') {
    return stage.f(multitaskResult.value);
  }

  throw new Error(`Cannot execute ${stage._tag} stage in worker thread`);
}

function captureResultForParentThread(f: () => any): void {
  try {
    const result = f();
    parentPort.postMessage(right(result));
  } catch (error) {
    parentPort.postMessage(left(error));
  }
}

export function workerThreadExecutor<A>(filename: string, task: Multitask<A>): Option<Task<Option<A>>> {
  if (isMainThread) {
    return some(executeTaskAsMainThread(filename, task));
  }

  captureResultForParentThread(() => executeTaskAsWorker(task));
  return none;
}
