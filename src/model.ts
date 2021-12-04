import { URIS } from 'fp-ts/HKT';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';
import { Traversable1 } from 'fp-ts/Traversable';

export interface MultitaskMap<A> {
  readonly _tag: 'MultitaskMap';
  f(value: any): A;
}

export interface MultitaskAp<A> {
  readonly _tag: 'MultitaskAp';
  readonly f: MultitaskX<(value: any) => A>;
}

export interface MultitaskPure<A> {
  readonly _tag: 'MultitaskPure';
  readonly value: A;
}

export interface MultitaskParFMap<A> {
  readonly _tag: 'MultitaskParFMap';
  readonly traversable: Traversable1<any>;
  f(a: any): A;
}

export type MultitaskOperation<A> =
  // | MultitaskPure<A>
  | MultitaskMap<A>
  | MultitaskAp<A>
  | MultitaskParFMap<A>;

export type Multitask<A> = NonEmptyArray<MultitaskOperation<any>>;
export interface MultitaskX<A> {
  initial: any;
  operations: MultitaskOperation<any>[];
}

// export function makeMultitaskChain<A, B>(f: (a: A) => Multitask<B>): MultitaskChain<B> {
//   return { f, _tag: 'MultitaskChain' };
// }

export function makeMultitaskMap<A, B>(f: (a: A) => B): MultitaskMap<B> {
  return { f, _tag: 'MultitaskMap' };
}

export function makeMultitaskAp<A, B>(f: MultitaskX<(a: A) => B>): MultitaskAp<B> {
  return { f, _tag: 'MultitaskAp' };
}

export function makeMultitaskPure<A>(value: A): MultitaskPure<A> {
  return { value, _tag: 'MultitaskPure' };
}

export function makeMultitaskParFMap<M extends URIS, A, B>(
  traversable: Traversable1<M>,
  f: (a: A) => B,
): MultitaskParFMap<B> {
  return { f, traversable, _tag: 'MultitaskParFMap' };
}

export const appendOperation = <B>(operation: MultitaskOperation<B>) => <A>(multitask: MultitaskX<A>): MultitaskX<B> => ({
  initial: multitask.initial,
  operations: [...multitask.operations, operation],
})
