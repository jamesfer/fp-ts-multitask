import { NonEmptyArray } from 'fp-ts/NonEmptyArray';

export interface MultitaskPointer {
  state: NonEmptyArray<[number, any]>;
  value: any;
}
