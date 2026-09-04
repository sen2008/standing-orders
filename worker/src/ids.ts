export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
