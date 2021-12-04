import { Applicative1 } from 'fp-ts/Applicative';
import { append } from 'fp-ts/Array';
import { Functor1 } from 'fp-ts/Functor';
import { Kind, URIS } from 'fp-ts/HKT';
import { Pointed1 } from 'fp-ts/Pointed';
import { Traversable1 } from 'fp-ts/Traversable';
import {
  appendOperation,
  makeMultitaskAp, makeMultitaskMap,
  makeMultitaskParFMap,
  makeMultitaskPure,
  Multitask,
  MultitaskOperation, MultitaskX,
} from './model';

export const URI = 'Multitask';

export type URI = typeof URI;

declare module 'fp-ts/lib/HKT' {
  interface URItoKind<A> {
    readonly Multitask: MultitaskX<A>
  }
}

export const of: Pointed1<URI>['of'] = initial => ({ initial, operations: [] });

const _map: Functor1<URI>['map'] = (ma, f) => appendOperation(makeMultitaskMap(f))(ma);

const _ap: Applicative1<URI>['ap'] = <A, B>(mab: MultitaskX<(a: A) => B>, ma: MultitaskX<A>) =>
  appendOperation(makeMultitaskAp(mab))(ma);

// const _chain: Chain1<URI>['chain'] = (ma, f) => append<MultitaskStage<any>>(makeMultitaskChain(f))(ma);

export const map = <A, B>(f: (a: A) => B) => (ma: MultitaskX<A>): MultitaskX<B> => _map(ma, f);
export const ap = <A>(ma: MultitaskX<A>) => <B>(mab: MultitaskX<(a: A) => B>): MultitaskX<B> => _ap(mab, ma);
// export const chain = <A, B>(f: (a: A) => Multitask<B>) => (ma: Multitask<A>): Multitask<B> => _chain(ma, f);

export const parFMap = <M extends URIS>(
  traversable: Traversable1<M>,
) => <A, B>(
  f: (a: A) => B,
) => (
  ma: MultitaskX<Kind<M, A>>
): MultitaskX<Kind<M, B>> => appendOperation(makeMultitaskParFMap(traversable, f))(ma);

export const Pointed: Pointed1<URI> = {
  URI,
  of,
}

export const Functor: Functor1<URI> = {
  URI,
  map: _map,
}

export const Applicative: Applicative1<URI> = {
  URI,
  of,
  map: _map,
  ap: _ap
}
