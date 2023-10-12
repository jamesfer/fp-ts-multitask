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


const runStep = (
  filename: string
) => (
  [parentPointers, [currentPointer, currentMultitask], childPointers]: StepState,
): Task<Either<StepState, any>> => {
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
  return a && typeof a === 'object' && Array.isArray(a['pointers']) && 'value' in a;
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

function executeTaskAsWorker<A>(task: MultitaskX<any>): Task<A> {
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

async function sendResultToParentThread<A>(f: Task<A>): Promise<void> {
  try {
    const result = await f();
    parentPort.postMessage(right(result));
  } catch (error) {
    parentPort.postMessage(left(error));
  }
}

export function gcpFunctionExecutor<A>(functionName: string, task: MultitaskX<A>): Task<Option<A>> {
  if (isMainThread) {
    return pipe(
      executeTaskAsMainThread(filename, task),
      mapT(some),
    );
  }

  return async () => {
    await sendResultToParentThread<A>(executeTaskAsWorker(task));
    return none;
  };
}
