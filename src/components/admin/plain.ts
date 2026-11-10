// Dữ liệu Prisma (Date, Decimal) → JSON thuần để truyền từ server component sang client component.
type DecimalLike = { toFixed: (n?: number) => string; toNumber: () => number };

export type Plain<T> = T extends Date
  ? string
  : T extends DecimalLike
    ? string
    : T extends (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export function plain<T>(value: T): Plain<T> {
  return JSON.parse(JSON.stringify(value)) as Plain<T>;
}
