import { z } from 'zod'

/** No credentials or transient URLs belong in a durable execution identity. */
export const videoExecutionContractSchema = z.object({
  schemaVersion: z.literal(1),
  modelKey: z.string().min(1),
  protocol: z.string().min(1),
  revision: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  channelFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type VideoExecutionContract = z.infer<typeof videoExecutionContractSchema>
