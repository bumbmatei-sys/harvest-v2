import { message } from "../i18n/messages";
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(message("LibEnv.missingRequiredEnvironmentVariableValue", { name: name }));
  return value;
}
