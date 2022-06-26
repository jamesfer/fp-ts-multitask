import { Applicative1 } from 'fp-ts/Applicative';
import { Functor1 } from 'fp-ts/Functor';
import { Kind, URIS } from 'fp-ts/HKT';
import { Pointed1 } from 'fp-ts/Pointed';
import { Traversable1 } from 'fp-ts/Traversable';
import {
  makeMultitaskAp, makeMultitaskMap,
  makeMultitaskParFMap,
  Multitask,
  MultitaskOperation, MultitaskX,
} from './model';
import { Task } from 'fp-ts/es6/Task';

export const URI = 'Multitask';

export type URI = typeof URI;

declare module 'fp-ts/lib/HKT' {
  interface URItoKind<A> {
    readonly Multitask: MultitaskX<A>
  }
}

const appendOperation = <B>(operation: MultitaskOperation<B>) => <A>(multitask: MultitaskX<A>): MultitaskX<B> => ({
  initial: multitask.initial,
  operations: [...multitask.operations, operation],
})

const _of: Pointed1<URI>['of'] = initial => ({ initial, operations: [] });

const _map: Functor1<URI>['map'] = (ma, f) => appendOperation(makeMultitaskMap(f))(ma);

const _ap: Applicative1<URI>['ap'] = (mab, ma) => appendOperation(makeMultitaskAp(mab))(ma);

export const Pointed: Pointed1<URI> = {
  URI,
  of: _of,
}

export const Functor: Functor1<URI> = {
  URI,
  map: _map,
}

export const Applicative: Applicative1<URI> = {
  URI,
  of: _of,
  map: _map,
  ap: _ap
}

export const of = _of;
export const map = <A, B>(f: (a: A) => B) => (ma: MultitaskX<A>): MultitaskX<B> => _map(ma, f);
export const ap = <A>(ma: MultitaskX<A>) => <B>(mab: MultitaskX<(a: A) => B>): MultitaskX<B> => _ap(mab, ma);

export const parFMap = <M extends URIS>(
  traversable: Traversable1<M>,
) => <A, B>(
  f: (a: A) => Task<B>,
) => (
  ma: MultitaskX<Kind<M, A>>
): MultitaskX<Kind<M, B>> => appendOperation(makeMultitaskParFMap(traversable, f))(ma);
