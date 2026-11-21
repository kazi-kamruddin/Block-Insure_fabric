// A policyholder signs the contract, so they must be an adult (18 to 100).
export function adultDateOfBirth(value: string, today = new Date().toISOString().slice(0, 10)) {
  const year = Number(today.slice(0, 4));
  return value <= `${year - 18}${today.slice(4)}` && value >= `${year - 100}${today.slice(4)}`;
}
