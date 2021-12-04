import { ChainRec1 } from 'fp-ts/ChainRec';
import { Either, isLeft, left } from 'fp-ts/Either';
import { Chain, Task, URI } from 'fp-ts/Task';

const _chainRec: ChainRec1<URI>['chainRec'] = <A, B>(a: A, f: (a: A) => Task<Either<A, B>>): Task<B> => {
  return async () => {
    let value: Either<A, B> = left(a);
    while (isLeft(value)) {
      value = await f(value.left)();
    }

    return value.right;
  };
};

export const ChainRec: ChainRec1<URI> = {
  ...Chain,
  chainRec: _chainRec,
}

export const chainRec = <A, B>(f: (a: A) => Task<Either<A, B>>) => (a: A): Task<B> => _chainRec(a, f);
