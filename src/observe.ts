import { createObserveModule } from '@nestjs/observe';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// Telemetry is only sent when real credentials are configured; without them the
// collector rejects every batch.
export const observeEnabled = Boolean(
  process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET,
);

export const observeInstrument = observeEnabled ? ObserveInstrument : undefined;
