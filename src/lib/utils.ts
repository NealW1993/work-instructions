import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function normalizePin(pin: string): string {
  return pin.replace(/\D/g, "").slice(0, 6);
}

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function escapeLikeQuery(value: string): string {
  return value.replace(/[%,_]/g, "");
}

export function normalizeEmployeeId(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isValidEmployeeId(value: string): boolean {
  return /^[0-9]{1,6}$/.test(value);
}
