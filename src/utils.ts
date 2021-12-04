export const makeTuple = <A>(a: A) => <B>(b: B): [A, B] => [a, b];

export const makeTriple = <A>(a: A) => <B>(b: B) => <C>(c: C): [A, B, C] => [a, b, c];
