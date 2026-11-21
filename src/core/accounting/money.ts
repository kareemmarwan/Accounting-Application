export type Minor = number;

export class InvalidAmountError extends Error {
  constructor(message = "قيمة مالية غير صالحة") {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export function toMinor(input: string | number): Minor {
  const raw =
    typeof input === "number"
      ? Number.isFinite(input)
        ? input.toFixed(2)
        : ""
      : input.trim();

  if (raw.length === 0 || !/^[+-]?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new InvalidAmountError(`مبلغ غير صالح: "${input}"`);
  }

  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [intPart = "0", fracPart = ""] = unsigned.split(".");
  const frac2 = (fracPart + "00").slice(0, 2);
  const value = Number(intPart) * 100 + Number(frac2);
  return negative ? -value : value;
}

export function fromMinor(value: Minor): string {
  if (!Number.isInteger(value)) throw new InvalidAmountError();
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function assertIntegerAmount(value: Minor): void {
  if (!Number.isInteger(value)) {
    throw new InvalidAmountError("المبلغ يجب أن يكون بوحدات صغرى صحيحة");
  }
}

export function assertPositive(value: Minor): void {
  assertIntegerAmount(value);
  if (value <= 0) {
    throw new InvalidAmountError("المبلغ يجب أن يكون أكبر من صفر");
  }
}

export function assertNonNegative(value: Minor): void {
  assertIntegerAmount(value);
  if (value < 0) {
    throw new InvalidAmountError("المبلغ لا يجوز أن يكون سالباً");
  }
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce((total, value) => total + value, 0);
}
