import { matchLeft } from 'fp-ts/Array';
import { Either, isLeft, left, right } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { none, Option, some } from 'fp-ts/Option';
import { map as mapT, of as ofT, Task } from 'fp-ts/Task';
import { ApplicativePar, tryCatch } from 'fp-ts/TaskEither';
import { isMainThread, parentPort, Worker, workerData } from 'worker_threads';
import { MultitaskOperation, MultitaskX } from '../../model';
import { makeTriple } from '../../utils';
import { chainRec } from '../../utils/chainRecTask';
import { recoverWith } from '../../utils/recoverWith';

interface OperationPointer {
  index: number;
  value: any;
}

type StepState = [
  [OperationPointer, MultitaskX<any>][],
  [OperationPointer, MultitaskX<any>],
  OperationPointer[]
];

interface WorkerPointer {
  pointers: number[],
  value: any,
}

function startWorker(filename: string, workerData: WorkerPointer): Promise<any> {
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

// Pop first pointer of NonEmptyArray
// Find taskEntry in multitask. If pointer is past the end, then the operation is done
//   current multitask: Multitask
//   current pointer: P
//   current operation: Operation
//   parentPointers: { P, Multitask }[]
//   remainingPointers: P[]
//
// If pointer is out of bounds -> shift upwards, if no parents, we are done
// If pointer is at a regular task -> run task, increment current pointer
// If pointer is at Ap and there are no more pointers -> add Ap pointer to parents, create new
//   pointer as current
// If pointer is at Ap and the next pointer is out of bounds -> subtask is done, evaluate ap
//   function and increment current pointer with the result
// If pointer is at Ap and there are more pointers -> this shouldn't occur


const runStep = (filename: string) => ([parentPointers, [currentPointer, currentMultitask], childPointers]: StepState): Task<Either<StepState, any>> => {
  if (currentPointer.index >= currentMultitask.operations.length) {
    // Out of bounds
    return pipe(
      parentPointers,
      matchLeft(
        // No parent pointers, entire task is complete
        () => right(currentPointer.value),
        // There are parents, leave this pointer untouched, and make the parent the current
        ([parentPointer, parentMultitask], remainingParents) => (
          left(makeTriple<[OperationPointer, MultitaskX<any>][]>(remainingParents)<[OperationPointer, MultitaskX<any>]>(
            [parentPointer, parentMultitask])<OperationPointer[]>(
            [currentPointer, ...childPointers]))
        ),
      ),
      ofT,
    );
  } else {
    const operation = currentMultitask.operations[currentPointer.index];
    if (operation._tag === 'MultitaskMap') {
      // Run task normally
      return pipe(
        left(
          makeTriple<[OperationPointer, MultitaskX<any>][]>(
            parentPointers,
          )<[OperationPointer, MultitaskX<any>]>(
            [{
              index: currentPointer.index + 1,
              value: operation.f(currentPointer.value)
            }, currentMultitask],
          )<OperationPointer[]>(
            []
          )
        ),
        ofT,
      );
    } else if (operation._tag === 'MultitaskParFMap') {
      return pipe(
        operation.traversable.traverse(ApplicativePar)(currentPointer.value, (value) => {
          const workerPointer: WorkerPointer = {
            value,
            pointers: [...parentPointers.map(([p]) => p.index), currentPointer.index],
          };
          return tryCatch(
            () => startWorker(filename, workerPointer),
            (reason: any) => reason instanceof Error ? reason : new Error(reason),
          );
        }),
        recoverWith<Error, any>((error) => {
          throw error;
        }),
        mapT(result => left(
          makeTriple<[OperationPointer, MultitaskX<any>][]>(
            parentPointers,
          )<[OperationPointer, MultitaskX<any>]>(
            [{ index: currentPointer.index + 1, value: result }, currentMultitask],
          )<OperationPointer[]>(
            []
          )
        )),
      );
    } else {
      // Operation is Ap
      return pipe(
        childPointers,
        matchLeft(
          // No child pointers, need to add one and make it active,
          () => left(
            makeTriple<[OperationPointer, MultitaskX<any>][]>(
              [[currentPointer, currentMultitask], ...parentPointers],
            )<[OperationPointer, MultitaskX<any>]>(
              [{ index: 0, value: operation.f.initial }, operation.f],
            )<OperationPointer[]>(
              []
            )
          ),
          // There is a child pointer, we only reach this state if the child has completed
          // Run the Ap function and increment the pointer
          (childPointer) => left(
            makeTriple<[OperationPointer, MultitaskX<any>][]>(
              parentPointers,
            )<[OperationPointer, MultitaskX<any>]>(
              [{
                index: currentPointer.index + 1,
                value: childPointer.value(currentPointer.value)
              }, operation.f],
            )<OperationPointer[]>(
              []
            )
          ),
        ),
        ofT,
      );
    }
  }
}

function executeTaskAsMainThread<A>(filename: string, multitask: MultitaskX<A>): Task<A> {
  return pipe(
    [[], [{ index: 0, value: multitask.initial }, multitask], []],
    chainRec(runStep(filename)),
  );
}

function isWorkerPointer(a: unknown): a is WorkerPointer {
  return a && typeof a === 'object' && Array.isArray(a['pointers']) && 'currentValue' in a;
}

function findWorkerStep(multitask: MultitaskX<any>, workerPointer: WorkerPointer): MultitaskOperation<any> {
  const [firstIndex, ...remainingIndices] = workerPointer.pointers;
  const firstOperation = multitask.operations[firstIndex];

  return remainingIndices.reduce(
    (operation, index) => {
      if (operation._tag !== 'MultitaskAp') {
        throw new Error(`Cannot use a pointer on an operation that is not Ap. Instead got: ${JSON.stringify(operation)}`)
      }

      return operation.f.operations[index];
    },
    firstOperation,
  )
}

function executeTaskAsWorker<A>(task: MultitaskX<any>): A {
  const workerPointer = workerData;
  if (!isWorkerPointer(workerPointer)) {
    const dataString = JSON.stringify(workerPointer, undefined, 2);
    throw new Error(`Failed to decode worker data into a MultitaskResult: ${dataString}`);
  }

  const operation = findWorkerStep(task, workerPointer)
  if (operation._tag !== 'MultitaskParFMap') {
    throw new Error(`Cannot execute ${operation._tag} stage in worker thread`);
  }

  return operation.f(workerPointer.value);
}

function sendResultToParentThread(f: () => any): void {
  try {
    const result = f();
    parentPort.postMessage(right(result));
  } catch (error) {
    parentPort.postMessage(left(error));
  }
}

export function workerThreadExecutor<A>(filename: string, task: MultitaskX<A>): Option<Task<A>> {
  if (isMainThread) {
    return some(executeTaskAsMainThread(filename, task));
  }

  sendResultToParentThread(() => executeTaskAsWorker(task));
  return none;
}


// const runParFMap = <U extends URIS, A>(
//   traversable: Traversable1<U>,
//   filename: string,
//   wrappedValue: Kind<U, any>,
//   state: NonEmptyArray<[number, any]>,
// ): Task<Kind<U, A>> => {
//   return pipe(
//     traversable.traverse(ApplicativePar)(wrappedValue, (value) => {
//       const multitaskPointer: MultitaskPointer = { state, value };
//       return tryCatch(
//         () => runWorker(filename, multitaskPointer),
//         (reason: any) => reason instanceof Error ? reason : new Error(reason),
//       );
//     }),
//     recoverWith<Error, any>((error) => {
//       throw error;
//     }),
//   );
// }
//
// // const runStage = <A>(
// //   filename: string,
// //   value: any,
// //   cursor: number[],
// // ) => (
// //   stage: MultitaskOperation<A>,
// // ): Task<[A, Option<MultitaskX<any>>]> => {
// //   switch (stage._tag) {
// //     // case 'MultitaskChain':
// //     //   return ofT(makeTuple(none)(stage.f(input)));
// //     // case 'MultitaskPure':
// //     //   return ofT(makeTuple(some(stage.value))([]));
// //     case 'MultitaskMap':
// //       return ofT(makeTuple(stage.f(value))(none));
// //     case 'MultitaskAp':
// //       return ofT(makeTuple(value)());
// //     case 'MultitaskParFMap': {
// //       return pipe(
// //         runParTraverseChain(stage.traversable, filename, value, index),
// //         mapT((result: A)  => makeTuple(some(result))([])),
// //       );
// //     }
// //     default:
// //       return absurd(stage);
// //   }
// // }
//
// // const applyStage = (filename: string, maybeValue: Option<any>, index: number) => <A>(
// //   [head, tail]: [MultitaskOperation<A>, MultitaskOperation<any>[]],
// // ): TaskEither<Error, [Option<A>, MultitaskOperation<any>[]]> => {
// //   return pipe(
// //     maybeValue,
// //     fold(
// //       () => ofT(makeTuple(runInitialStage(head))(tail)),
// //       flow(
// //         runStage(filename, head, index),
// //         mapT(mapSnd(newStages => [...newStages, ...tail])),
// //       ),
// //     ),
// //   );
// // }
//
// // interface State {
// //   cursor: number;
// //   operations: MultitaskOperation<any>[],
// //   parent: Option<State>;
// // }
// //
// // function getCursor(state: State): NonEmptyArray<number> {
// //   return tailRec(
// //     makeTuple(state.parent)(of(state.cursor)),
// //     ([maybeParent, cursor]) => pipe(
// //       maybeParent,
// //       foldO(
// //         () => right(cursor),
// //         parent => pipe(
// //           cursor,
// //           append(parent.cursor),
// //           makeTuple(parent.parent),
// //           left,
// //         ),
// //       ),
// //     ),
// //   );
// // }
//
// const lookupTask2 = <A>(
//   filename: string,
//   multitask: MultitaskX<A>,
// ) => (
//   state: NonEmptyArray<[number, any]>,
// ): Option<MultitaskOperation<any>> => {
//   return pipe(
//     state,
//     matchLeftNea(([headOffset, value], tailState) => pipe(
//       multitask.operations,
//       lookup(headOffset),
//       // mapO(task => ),
//     )),
//   );
// }
//
// const runTask2 = <A>(
//   filename: string,
//   multitask: MultitaskX<A>,
// ) => (
//   state: NonEmptyArray<[number, any]>,
// ): Task<Either<NonEmptyArray<[number, any]>, A>> => {
//   tailRec<[MultitaskX<A>, NonEmptyArray<[number, any]>], Task<Either<NonEmptyArray<[number, any]>, A>>>(
//     makeTuple(multitask)(state),
//     ([multitask, state]) => pipe(
//       state,
//       matchLeftNea(([headOffset, value], tailState) => pipe(
//         multitask.operations,
//         lookup(headOffset),
//         matchO(
//           // Offset index is at the end of the task so we are done
//           () => right(ofT(right(value))),
//           (task) => {
//
//           },
//         )
//       )),
//     ),
//   );
//
//   switch (task._tag) {
//     case 'MultitaskMap':
//       return ofT(left(of(makeTuple(headOffset + 1)(task.f(value)))));
//
//     case 'MultitaskAp':
//       return pipe(
//         tailState,
//         fromArray,
//         matchO(
//           // Tail state is empty, start processing the nested Multitask by appending a cursor
//           () => ofT(left([makeTuple(headOffset)(value), makeTuple(0)(task.f.initial)])),
//           // Tail state has an offset
//           (nonEmptyTailState) => pipe(
//             lookupTask2(filename, task.f)(nonEmptyTailState),
//             mapT(matchE(
//               // Nested task was not finished
//               (x) => left([makeTuple(headOffset)(value), ...x]),
//               // Nested task finished
//               (resultFunction) => left(of(makeTuple(headOffset + 1)(resultFunction(value)))),
//             )),
//           ),
//         ),
//       );
//
//     case 'MultitaskParFMap':
//       return pipe(
//         runParFMap(task.traversable, filename, value, rootState),
//         mapT(nextValue => left(of(makeTuple(headOffset + 1)(nextValue)))),
//       );
//
//     default:
//       return absurd(task);
//   }
// }
//
// interface TaskState {
//   offset: number;
//   value: any;
//   nestedState: Option<Either<TaskState, any>>;
// }
//
// type State = { offset: number, value: any };
// type X = NonEmptyArray<Either<State, any>>;
//
// const lookupTask3 = <A>(
//   filename: string,
//   multitask: MultitaskX<A>,
// ) => (
//   state: X,
// ): Task<Either<X, A>> => {
//   // const l: Task<Either<NonEmptyArray<Either<[number, any], any>>, A>>
//
//   return pipe(
//     makeTuple<State[]>([])(state),
//     chainRec<[State[], X], Either<X, A>>(([parentStates, states]) => pipe(
//       states,
//       matchLeftNea((headState, tailStates) => pipe(
//         headState,
//         matchE(
//           // Valid state, continue processing
//           (currentState): Task<Either<[State[], X], Either<X, A>>> => {
//             pipe(
//               multitask.operations,
//               lookup(currentState.offset),
//               matchO(
//                 // Offset index is at the end of the task so we are done on this level
//                 () => ofT(left(parentStates)),
//
//               ),
//             );
//           },
//           // State level complete
//           (value) => pipe(
//             parentStates,
//             matchRight(
//               // There are no more parents, so we are done this iteration
//               () => right(value),
//               (superParents, parent) => left(makeTuple(superParents)<X>([left(parent), right(value)])),
//             ),
//             ofT
//           )
//         ),
//       )),
//     ))
//   )
//
//   tailRec(makeTuple<State[]>([])(state), ([parentStates, states]) => pipe(
//     states,
//     matchLeftNea((headState, tailStates) => pipe(
//       headState,
//       matchE(
//         // Valid state, continue processing
//         (): Task<Either<[State[], X], Either<X, A>>> => {
//
//         },
//         // State level complete, return to processing a parent
//         (value) => pipe(
//           parentStates,
//           matchRight(
//             // There are no more parents, so we are done this step
//             () => right(value),
//             (grandParents, parent) => left(makeTuple(grandParents)<X>([left(parent), right(value)])),
//           ),
//           ofT
//         )
//       ),
//     )),
//   ));
//
//   const x = pipe(
//     multitask.operations,
//     lookup(state.offset),
//     matchO(
//       // Offset index is at the end of the task so we are done
//       () => ofT(right(state.value)),
//       (task): Task<Either<TaskState, A>> => {
//         switch (task._tag) {
//           case 'MultitaskMap':
//             return ofT(left({ offset: state.offset + 1, value: task.f(state.value), nestedState: none }));
//
//           case 'MultitaskAp':
//             return pipe(
//               state.nestedState,
//               fromArray,
//               matchO(
//                 // Tail state is empty, start processing the nested Multitask by appending a cursor
//                 () => ofT(left([makeTuple(offset)(value), makeTuple(0)(task.f.initial)])),
//                 // Tail state has an offset
//                 (nonEmptyTailState) => pipe(
//                   lookupTask(filename, task.f)(nonEmptyTailState),
//                   mapT(matchE(
//                     // Nested task was not finished
//                     (x) => left([makeTuple(offset)(value), ...x]),
//                     // Nested task finished
//                     (resultFunction) => left(of(makeTuple(offset + 1)(
//                       resultFunction(value)))),
//                   )),
//                 ),
//               ),
//             );
//
//           case 'MultitaskParFMap':
//             return pipe(
//               runParFMap(task.traversable, filename, value, state),
//               mapT(nextValue => left(of(makeTuple(offset + 1)(nextValue)))),
//             );
//
//           default:
//             return absurd(task);
//         }
//       },
//     )
//   );
// }
//
//
// const lookupTask = <A>(
//   filename: string,
//   multitask: MultitaskX<A>,
// ) => (
//   state: NonEmptyArray<[number, any]>,
// ): Task<Either<NonEmptyArray<[number, any]>, A>> => {
//   // const l: Task<Either<NonEmptyArray<Either<[number, any], any>>, A>>
//
//   return pipe(
//     state,
//     matchLeftNea(([headOffset, value], tailState) => pipe(
//       multitask.operations,
//       lookup(headOffset),
//       matchO(
//         // Offset index is at the end of the task so we are done
//         () => ofT(right(value)),
//         (task) => {
//           switch (task._tag) {
//             case 'MultitaskMap':
//               return ofT(left(of(makeTuple(headOffset + 1)(task.f(value)))));
//
//             case 'MultitaskAp':
//               return pipe(
//                 tailState,
//                 fromArray,
//                 matchO(
//                   // Tail state is empty, start processing the nested Multitask by appending a cursor
//                   () => ofT(left([makeTuple(headOffset)(value), makeTuple(0)(task.f.initial)])),
//                   // Tail state has an offset
//                   (nonEmptyTailState) => pipe(
//                     lookupTask(filename, task.f)(nonEmptyTailState),
//                     mapT(matchE(
//                       // Nested task was not finished
//                       (x) => left([makeTuple(headOffset)(value), ...x]),
//                       // Nested task finished
//                       (resultFunction) => left(of(makeTuple(headOffset + 1)(
//                         resultFunction(value)))),
//                     )),
//                   ),
//                 ),
//               );
//
//             case 'MultitaskParFMap':
//               return pipe(
//                 runParFMap(task.traversable, filename, value, state),
//                 mapT(nextValue => left(of(makeTuple(headOffset + 1)(nextValue)))),
//               );
//
//             default:
//               return absurd(task);
//           }
//         },
//       )
//     )),
//   );
// }

