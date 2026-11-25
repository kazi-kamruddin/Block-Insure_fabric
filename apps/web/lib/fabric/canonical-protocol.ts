const utf8 = new TextEncoder();

export function canonicalProtocolInput(domain: string, ...values: Array<string | number | boolean>) {
  return [domain, ...values.map(raw => {
    const value = String(raw);
    return `${utf8.encode(value).length}:${value}`;
  })].join("|");
}
