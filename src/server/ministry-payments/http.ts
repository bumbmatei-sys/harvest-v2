import { verifiedUser } from "../http";
import { AccessError } from "../permissions";
import { syntheticMinistryPayments } from "./provider";
import { paymentMissing } from "./service";

export async function ministryPaymentActor(request: Request) {
  if (!syntheticMinistryPayments()) throw paymentMissing();
  try {
    return await verifiedUser(request);
  } catch (error) {
    if (error instanceof AccessError && error.status === 401) throw paymentMissing();
    throw error;
  }
}
