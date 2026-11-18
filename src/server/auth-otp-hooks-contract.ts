export type AuthOtpInput = { email: string; type: string };

export type AuthOtpHooks = {
  run<T>(handler: () => Promise<T>): Promise<T>;
  reserve(email: string, sentAt: Date): void;
  generate(input: AuthOtpInput): string | undefined;
  deliver(input: AuthOtpInput, send: () => Promise<void>): Promise<void>;
  auditMetadata(): Record<string, string>;
};
