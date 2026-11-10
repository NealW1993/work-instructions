/** Mirrors public.is_weak_pin so forms can explain the rule before the database enforces it. */
const COMMON_PINS = new Set([
  "121212", "123123", "112233", "111222", "101010", "010101", "131313", "202020",
  "212121", "696969", "420420", "159753", "147258", "258369", "102030", "100200",
]);

export const PIN_POLICY_MESSAGE = "Choose a PIN that is harder to guess. Avoid repeated or sequential digits.";

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if ("01234567890123456".includes(pin) || "98765432109876543".includes(pin)) return true;
  return COMMON_PINS.has(pin);
}
