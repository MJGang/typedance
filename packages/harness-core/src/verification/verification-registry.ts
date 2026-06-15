export type HarnessVerificationStatus = "passed" | "failed" | "canceled";

export type HarnessVerificationResult = {
  status: HarnessVerificationStatus;
  summary?: string;
  details?: Record<string, unknown>;
};

export type HarnessVerificationRegistration = {
  id: string;
  name: string;
  handler: (input: Record<string, unknown>) => Promise<HarnessVerificationResult> | HarnessVerificationResult;
};

export class HarnessVerificationRegistry {
  #verifications = new Map<string, HarnessVerificationRegistration>();

  register(registration: HarnessVerificationRegistration): HarnessVerificationRegistration {
    this.#verifications.set(registration.id, registration);
    return registration;
  }

  get(id: string): HarnessVerificationRegistration {
    const registration = this.#verifications.get(id);
    if (!registration) {
      throw new Error(`Unknown harness verification: ${id}`);
    }
    return registration;
  }
}
