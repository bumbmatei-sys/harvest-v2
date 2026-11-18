export type AuthOtpInput = { email: string; type: string };

export type AuthOtpHooks = {
  run<T>(handler: () => Promise<T>): Promise<T>;
  reserve(email: string, sentAt: Date, reservationId: string): void;
  prepareVerification(email: string): Promise<void>;
  storedHash(email: string, hash: string): string;
  generate(input: AuthOtpInput): string | undefined;
  deliver(input: AuthOtpInput, send: () => Promise<void>): Promise<void>;
  auditMetadata(): Record<string, string>;
};
