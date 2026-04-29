import { Injectable, Logger } from '@nestjs/common';

// We define strict types for the possible outcomes from the external system.
export type HcmSyncResult =
  | { success: true; externalId: string }
  | { success: false; reason: 'REJECTED' | 'TIMEOUT' | 'UNKNOWN_ERROR' };

@Injectable()
export class HcmMockClient {
  private readonly logger = new Logger(HcmMockClient.name);

  /**
   * Simulates an external HTTP call to the HCM's real-time API.
   * Deliberately introduces latency and random failures to test defensive programming.
   * * @param employeeId - The employee dimension
   * @param locationId - The location dimension
   * @param amount - The requested time-off amount
   */
  async syncTimeOffRequest(
    employeeId: string,
    locationId: string,
    amount: number,
  ): Promise<HcmSyncResult> {
    this.logger.log(
      `[MOCK HCM] Outbound request started -> Emp: ${employeeId}, Amount: ${amount}`,
    );

    // Simulate network latency (between 500ms and 1500ms)
    const latency = Math.floor(Math.random() * 1000) + 500;
    await new Promise((resolve) => setTimeout(resolve, latency));

    // Simulate real-world unreliability:
    // 80% Success, 10% Explicit Rejection (422), 10% Network Timeout/500 Error
    const randomSeed = Math.random();

    if (randomSeed < 0.8) {
      this.logger.log(`[MOCK HCM] Responded with SUCCESS (200 OK)`);
      return { success: true, externalId: `HCM-REQ-${Date.now()}` };
    }

    if (randomSeed < 0.9) {
      this.logger.warn(
        `[MOCK HCM] Responded with REJECTION (422 Unprocessable Entity)`,
      );
      return { success: false, reason: 'REJECTED' };
    }

    this.logger.error(`[MOCK HCM] Responded with TIMEOUT / 500 Internal Error`);
    return { success: false, reason: 'TIMEOUT' };
  }
}
