export const PROTOCOL_VERSION = 'backrooms.v0' as const;
export const CLIENT_VERSION = '0.1.0-dev.5' as const;
export const MAX_LESSON_BYTES = 96;

export type Digest = string;
export type U64 = string;
export type Procedure = 0 | 1;

export interface Checkpoint {
  roomId: Digest;
  uniqueAddress: Digest;
  stateCommitment: Digest;
  revision: U64;
}

export interface CreateRoomInput {
  creationNonce: Digest;
  seedManifestCommitment: Digest;
  fixedMembersCommitment: Digest;
}

export interface LearningProposal {
  lesson: string;
  selectedProcedure: Procedure;
  feedback: { negative: boolean; magnitude: number };
}

export interface AdvanceRoomInput extends LearningProposal {
  acceptanceNonce: Digest;
  roomId: Digest;
  expectedPredecessor: Digest;
  ordinal: U64;
  episodeCommitment: Digest;
  originalResultCommitment: Digest;
  candidateCommitment: Digest;
  minimumConfirmedSlot: U64;
}

export interface PreparedTransaction {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  status: 'prepared';
  transactionBase64: string;
  transactionDigest: Digest;
  checkpoint: Checkpoint;
  proofs: { applicationProofDigest: Digest; privateTxHash: Digest };
  artifactVersion: string;
  authorizationCommitment?: Digest;
}

export interface ConfirmedTransaction {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  status: 'confirmed';
  signature: string;
  slot: U64;
}

export interface UnknownTransaction {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  status: 'unknown';
  signature: string;
}

export interface ExpiredTransaction {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  status: 'expired';
  signature: string;
}

export interface ReframedTransaction {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  status: 'reframed';
  transactionBase64: string;
  transactionDigest: Digest;
  parentTransactionDigest: Digest;
  signature: string;
}

export interface PriorTransactionFrame {
  transactionBase64: string;
  transactionDigest: Digest;
  signature: string;
}

export interface RecoveredRoom {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  status: 'recovered';
  checkpoint: Checkpoint;
  memory: {
    lesson: string;
    episodeCommitment: Digest;
    originalResultCommitment: Digest;
    candidateCommitment: Digest;
    predecessorCommitment: Digest;
    authorizationCommitment: Digest;
  };
  policy: { policyId: '1'; scores: [number, number] };
  slot: U64;
  contextSlot: U64;
  signature: string;
  seedManifestCommitment: Digest;
  fixedMembersCommitment: Digest;
  writerIdentity: string;
  artifactVersion: string;
}

export type UnrecoveredRoom = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
} & (
  | { status: 'not_found'; contextSlot: U64 }
  | { status: 'pending' }
);

export type BridgeRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
} & (
  | { op: 'prepare_create'; input: CreateRoomInput }
  | { op: 'prepare_advance'; input: AdvanceRoomInput }
  | { op: 'submit'; input: { transactionBase64: string; transactionDigest: Digest } }
  | { op: 'reframe'; input: { transactionBase64: string; transactionDigest: Digest } }
  | { op: 'recover'; input: { roomId: Digest; minimumConfirmedSlot: U64 } }
);

export interface RingsTransport {
  request(request: BridgeRequest): Promise<unknown>;
}

export interface PrivateRecordStore {
  read<T>(key: string): Promise<{ value: T; version: number } | undefined>;
  create<T>(key: string, value: T): Promise<boolean>;
  replace<T>(key: string, expectedVersion: number, value: T): Promise<boolean>;
}

export interface EpisodeBinding {
  roomId: Digest;
  episodeId: string;
  episodeCommitment: Digest;
  predecessor: Checkpoint;
  ordinal: U64;
  minimumConfirmedSlot: U64;
  residentIds: readonly [string, string];
}

export interface OriginalResult {
  episodeId: string;
  originalResultCommitment: Digest;
  candidateCommitment: Digest;
  investigator: string;
  critic: string;
  proposal: LearningProposal;
}

export interface AcceptanceAuthorization extends AdvanceRoomInput {
  episodeId: string;
  operationId: string;
}

export interface EpisodeAuthority {
  resolveEpisode(binding: EpisodeBinding): Promise<EpisodeBinding>;
  getOriginalResult(episodeId: string): Promise<OriginalResult | undefined>;
  captureOriginalResult(binding: EpisodeBinding, result: OriginalResult): Promise<OriginalResult>;
  authorizeAcceptance(binding: EpisodeBinding, result: OriginalResult): Promise<AcceptanceAuthorization>;
}

export interface ResidentRuntime {
  run(binding: EpisodeBinding, room: RecoveredRoom): Promise<OriginalResult>;
}

export type LearningOutcome =
  | { status: 'accepted'; originalResult: OriginalResult; room: RecoveredRoom }
  | { status: 'commit_pending'; originalResult: OriginalResult; operationId: string; reason: 'prepare_failed' | 'submission_unknown' | 'recovery_pending' | 'transaction_expired' }
  | { status: 'state_conflict'; originalResult: OriginalResult; operationId: string };

export interface Diagnostic {
  event: 'episode_captured' | 'transaction_prepared' | 'submission_unknown' | 'state_recovered';
  operationId: string;
  revision?: U64;
}

export type DiagnosticSink = (event: Diagnostic) => void;
