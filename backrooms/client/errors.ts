export type RingsErrorCode = 'invalid_request' | 'state_conflict' | 'artifact_mismatch' | 'recovery_unavailable' | 'proof_failed' | 'operation_failed' | 'transaction_live';

export class RingsOperationError extends Error {
  constructor(readonly code: RingsErrorCode) { super(`rings_${code}`); this.name = 'RingsOperationError'; }
}

export function isRingsErrorCode(code: unknown): code is RingsErrorCode {
  return typeof code === 'string' && ['invalid_request', 'state_conflict', 'artifact_mismatch', 'recovery_unavailable', 'proof_failed', 'operation_failed', 'transaction_live'].includes(code);
}
