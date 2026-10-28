export type AccountResult = {
  status: number;
  json?: unknown;
  raw?: Buffer;
  headers?: Record<string, string>;
  cookies?: string[];
};

export function openAccounts(): void;
export function closeAccounts(): void;
export function accountPath(pathname: string): boolean;
export function dispatchAccount(input: {
  method: string;
  path: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
}): Promise<AccountResult | null>;
