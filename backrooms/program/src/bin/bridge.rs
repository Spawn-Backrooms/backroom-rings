use anyhow::{anyhow, ensure, Context, Result};
use backroom_rings_program::{
    circuits::*,
    client::RoomInstruction,
    instructions::{AdvanceArgs, CreateArgs},
    tag, ID,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_address::Address;
use solana_commitment_config::CommitmentConfig;
use solana_message::VersionedMessage;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use spr_client::{
    compile_message, sign_transaction, ComputeBudgetConfig, HistoryFilters, IndexerRpcConfig,
    ProofDataSource, ProverClient, Rpc, SolanaRpc, SprClient, SprIndexer,
};
use spr_interface::instruction::instruction_data::transact::TransactIxData;
use spr_keypair::{ShieldedKeypair, SigningKey};
use spr_program::{
    checked, from_bytes, to_bytes, DataUtxo, Field, InputRecords, ProgramOwner, ProgramTransaction,
};
use spr_transaction::{AssetRegistry, ShieldedTransaction};
use std::{
    io::{self, Read},
    path::PathBuf,
    str::FromStr,
};

const VERSION: &str = "backrooms.v0";
const ARTIFACT_VERSION: &str = "backrooms.localnet.v0";
type Client = SprClient<SolanaRpc>;

#[cfg(test)]
#[path = "bridge/recovery.rs"]
mod recovery_tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    signer_seed_hex: String,
    rpc_url: String,
    indexer_url: String,
    prover_url: String,
    tree_address: String,
    tree_id: u16,
    artifacts_directory: PathBuf,
    genesis_hash: String,
    program_binary_sha256: String,
    shielded_pool_binary_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: String,
    operation_id: String,
    op: String,
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateInput {
    creation_nonce: String,
    seed_manifest_commitment: String,
    fixed_members_commitment: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Feedback {
    negative: bool,
    magnitude: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdvanceInput {
    room_id: String,
    expected_predecessor: String,
    acceptance_nonce: String,
    ordinal: String,
    episode_commitment: String,
    original_result_commitment: String,
    candidate_commitment: String,
    lesson: String,
    selected_procedure: u8,
    feedback: Feedback,
    minimum_confirmed_slot: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitInput {
    transaction_base64: String,
    transaction_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoverInput {
    room_id: String,
    minimum_confirmed_slot: String,
}

struct Host {
    config: Config,
    client: Client,
    writer: ShieldedKeypair,
}

struct RoomScan {
    note: Option<DataUtxo<RoomStateV0>>,
    context_slot: u64,
}

enum SubmissionState {
    Confirmed(u64),
    Live,
    Expired,
    Unknown,
}

impl SubmissionState {
    fn response(self, transaction: &VersionedTransaction) -> Value {
        let signature = transaction.signatures[0].to_string();
        match self {
            Self::Confirmed(slot) => {
                json!({ "status": "confirmed", "signature": signature, "slot": slot.to_string() })
            }
            Self::Expired => json!({ "status": "expired", "signature": signature }),
            Self::Live | Self::Unknown => json!({ "status": "unknown", "signature": signature }),
        }
    }
}

fn bytes32(value: &str) -> Result<[u8; 32]> {
    ensure!(
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "invalid 32-byte hex"
    );
    Ok(hex::decode(value)?
        .try_into()
        .map_err(|_| anyhow!("invalid digest length"))?)
}

fn decimal(value: &str) -> Result<u64> {
    let number: u64 = value.parse()?;
    ensure!(number.to_string() == value, "invalid decimal u64");
    Ok(number)
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn program_bytes(rpc: &SolanaRpc, id: Address) -> Result<Vec<u8>> {
    use solana_sdk_ids::{bpf_loader, bpf_loader_deprecated, bpf_loader_upgradeable, loader_v4};
    let account = rpc
        .get_account(id)?
        .ok_or_else(|| anyhow!("program absent"))?;
    ensure!(account.executable, "program is not executable");
    if account.owner == bpf_loader_upgradeable::ID {
        let data_id = solana_loader_v3_interface::get_program_data_address(&id);
        let data = rpc
            .get_account(data_id)?
            .ok_or_else(|| anyhow!("program data absent"))?;
        ensure!(
            data.owner == bpf_loader_upgradeable::ID && data.data.get(..4) == Some(&[3, 0, 0, 0]),
            "invalid program data"
        );
        let offset =
            solana_loader_v3_interface::state::UpgradeableLoaderState::size_of_programdata_metadata(
            );
        return Ok(data
            .data
            .get(offset..)
            .ok_or_else(|| anyhow!("short program data"))?
            .to_vec());
    }
    let offset = if account.owner == loader_v4::ID {
        solana_loader_v4_interface::state::LoaderV4State::program_data_offset()
    } else {
        ensure!(
            account.owner == bpf_loader::ID || account.owner == bpf_loader_deprecated::ID,
            "unexpected program loader"
        );
        0
    };
    Ok(account
        .data
        .get(offset..)
        .ok_or_else(|| anyhow!("short program account"))?
        .to_vec())
}

impl Host {
    fn load() -> Result<Self> {
        let path = PathBuf::from(std::env::var("BACKROOM_RINGS_CONFIG")?);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            ensure!(
                std::fs::metadata(&path)?.permissions().mode() & 0o077 == 0,
                "config must be owner-readable only"
            );
        }
        let config: Config = serde_json::from_slice(&std::fs::read(path)?)?;
        for endpoint in [&config.rpc_url, &config.indexer_url, &config.prover_url] {
            let url = url::Url::parse(endpoint)?;
            ensure!(
                url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "[::1]")),
                "localnet endpoints must use loopback HTTP"
            );
            ensure!(
                url.username().is_empty() && url.password().is_none(),
                "endpoint credentials are forbidden"
            );
        }
        let writer = ShieldedKeypair::from_keypair(SigningKey::from_ed25519_bytes(&bytes32(
            &config.signer_seed_hex,
        )?))?;
        let rpc = SolanaRpc::new(config.rpc_url.clone());
        ensure!(
            rpc.client().get_genesis_hash()?.to_string() == config.genesis_hash,
            "genesis differs from retained localnet"
        );
        for (id, expected) in [
            (ID, &config.program_binary_sha256),
            (
                Address::new_from_array(spr_interface::SHIELDED_POOL_PROGRAM_ID),
                &config.shielded_pool_binary_sha256,
            ),
        ] {
            bytes32(expected)?;
            ensure!(
                digest(&program_bytes(&rpc, id)?) == *expected,
                "program binary differs from retained localnet"
            );
        }
        let client = SprClient::new(
            rpc,
            SprIndexer::new(&config.indexer_url),
            ProverClient::new(config.prover_url.clone()),
        )
        .with_proof_data_source(ProofDataSource::Client);
        Ok(Self {
            config,
            client,
            writer,
        })
    }

    fn authority(&self) -> ProgramOwner {
        room_authority(&self.writer.pubkey())
    }

    fn recover_note(&self, room: Field, minimum: u64) -> Result<RoomScan> {
        let snapshot = self.client.get_slot()?.max(minimum);
        let mut cursor = None;
        let mut transactions: Vec<ShieldedTransaction> = Vec::new();
        let mut filters = HistoryFilters::default();
        filters.slot.lte = Some(snapshot);
        loop {
            let page = self
                .client
                .get_shielded_transactions_by_tags(
                    vec![self.authority().confidential_view_tag()],
                    cursor,
                    Some(100),
                    filters,
                    Some(IndexerRpcConfig::at_slot(snapshot)),
                )
                .context(BridgeFailure::RecoveryUnavailable)?;
            ensure!(page.context.slot >= snapshot, "indexer is behind snapshot");
            transactions.extend(page.data.into_iter().flat_map(|event| event.events));
            match page.pagination_token {
                Some(next) => {
                    ensure!(
                        cursor.is_none_or(|previous| next > previous),
                        "indexer cursor did not advance"
                    );
                    cursor = Some(next);
                }
                None => break,
            }
        }
        let mut live = self
            .authority()
            .decrypt_data_utxos::<RoomStateV0>(
                &self.writer.viewing_key,
                &transactions,
                &AssetRegistry::default(),
            )?
            .into_iter()
            .filter(|note| note.data.identity().is_ok_and(|id| id == room));
        let note = live.next();
        ensure!(live.next().is_none(), "more than one live room checkpoint");
        if let Some(note) = &note {
            checked(|| {
                note.data.validate();
                Ok(())
            })?;
            ensure!(note.address.is_some(), "room is not unique");
            let expected =
                spr_hasher::primitives::solana_owner_identity(self.writer.pubkey().as_array())?;
            ensure!(
                to_bytes(&note.data.writer.key().identity()?) == expected,
                "room writer differs from host"
            );
        }
        Ok(RoomScan {
            note,
            context_slot: snapshot,
        })
    }

    fn checkpoint(&self, note: &DataUtxo<RoomStateV0>) -> Result<Value> {
        Ok(
            json!({ "roomId": hex::encode(to_bytes(&note.data.identity()?)), "uniqueAddress": hex::encode(note.address.ok_or_else(|| anyhow!("unique address absent"))?), "stateCommitment": hex::encode(note.utxo.utxo_hash), "revision": note.data.revision.to_string() }),
        )
    }

    fn prepare(
        &self,
        name: &str,
        transaction: ProgramTransaction,
        room: Field,
        authorization: Option<Field>,
    ) -> Result<Value> {
        let result = xark::prover::circuit_at(self.config.artifacts_directory.join(name))
            .prove(transaction.proof_inputs)
            .context(BridgeFailure::ProofFailed)?;
        let proof =
            spr_program::proof::compressed_proof(&result.proof).map_err(anyhow::Error::msg)?;
        let proof_digest = digest(&wincode::serialize(&proof)?);
        let note = DataUtxo::<RoomStateV0>::try_from(self.authority().input(
            &transaction.finalized.output_utxos()[0],
            self.config.tree_id,
            0,
        )?)?;
        let encrypted = transaction.finalized.encrypt_with_keys(&self.writer)?;
        let transact = self
            .client
            .prove_transact(encrypted, None, &ProgramOwner::nullifier_key())
            .context(BridgeFailure::ProofFailed)?;
        let private_tx_hash = hex::encode(transact.private_tx_hash);
        let instruction = RoomInstruction {
            writer: self.writer.pubkey(),
            tree: Address::from_str(&self.config.tree_address)?,
            proof,
            viewing_pubkey: *self.writer.viewing_pubkey().as_bytes(),
            room_identity: to_bytes(&room),
            transact,
        };
        let instruction = match authorization {
            Some(commitment) => instruction.advance(to_bytes(&commitment))?,
            None => instruction.create()?,
        };
        let (blockhash, _) = self.client.get_latest_blockhash()?;
        let message = compile_message(
            &self.writer.pubkey(),
            &[instruction],
            blockhash,
            ComputeBudgetConfig::new(1_400_000),
        )?;
        let signed = sign_transaction(message, &[&self.writer])?;
        let bytes = wincode::serialize(&signed)?;
        ensure!(
            bytes.len() <= solana_message::v1::MAX_TRANSACTION_SIZE,
            "transaction exceeds upstream v1 limit"
        );
        let mut response = json!({ "status": "prepared", "transactionBase64": STANDARD.encode(&bytes), "transactionDigest": digest(&bytes), "checkpoint": self.checkpoint(&note)?, "proofs": { "applicationProofDigest": proof_digest, "privateTxHash": private_tx_hash }, "artifactVersion": ARTIFACT_VERSION });
        if let Some(commitment) = authorization {
            response["authorizationCommitment"] = json!(hex::encode(to_bytes(&commitment)));
        }
        Ok(response)
    }

    fn create(&self, input: CreateInput) -> Result<Value> {
        let address = self.writer.shielded_address()?;
        let mut records = InputRecords::new();
        let owner = *records.address(&address)?.owner();
        let binding = RoomBinding {
            schema: backroom_rings_program::SCHEMA,
            deployment: backroom_rings_program::DEPLOYMENT,
            program_id: backroom_rings_program::PROGRAM_DOMAIN,
            creation_nonce: bytes32(&input.creation_nonce)?,
        };
        let room = RoomStateV0 {
            binding,
            writer: owner,
            ..Default::default()
        }
        .identity()?;
        if self.recover_note(room, 0)?.note.is_some() {
            return Err(BridgeFailure::StateConflict.into());
        }
        let program = CreateRoom {
            private: CreateRoomPrivateInputs {
                tx_context: InputRecords::context(
                    &spr_keypair::random_blinding(),
                    Some(self.config.tree_id),
                )?,
                creation_nonce: binding.creation_nonce,
                seed_manifest: bytes32(&input.seed_manifest_commitment)?,
                fixed_members: bytes32(&input.fixed_members_commitment)?,
                writer: owner,
            },
            public: CreateRoomPublicInputs {
                room_owner: records
                    .address(&self.authority().address(self.writer.viewing_pubkey())?)?,
                writer_identity: owner.key().identity()?,
                room_identity: room,
            },
        };
        let transaction = records.create_program_transaction(
            &program,
            checked(|| program.execute())?,
            &address,
            self.writer.pubkey(),
        )?;
        self.prepare("create_room", transaction, room, None)
    }

    fn advance(&self, input: AdvanceInput) -> Result<Value> {
        ensure!(
            !input.lesson.is_empty()
                && input.lesson.len() <= backroom_rings_program::LESSON_CAPACITY,
            "lesson exceeds bound"
        );
        ensure!(
            input.selected_procedure <= 1 && input.feedback.magnitude <= 10,
            "feedback exceeds bound"
        );
        let room = from_bytes(&bytes32(&input.room_id)?)?;
        let note = self
            .recover_note(room, decimal(&input.minimum_confirmed_slot)?)?
            .note
            .ok_or_else(|| anyhow!("room absent"))?;
        if note.utxo.utxo_hash != bytes32(&input.expected_predecessor)? {
            return Err(BridgeFailure::StateConflict.into());
        }
        let mut memory = AcceptedMemory {
            length: input.lesson.len() as u8,
            episode: bytes32(&input.episode_commitment)?,
            original_result: bytes32(&input.original_result_commitment)?,
            candidate: bytes32(&input.candidate_commitment)?,
            ..Default::default()
        };
        memory.lesson[..input.lesson.len()].copy_from_slice(input.lesson.as_bytes());
        ensure!(
            bytes32(&input.acceptance_nonce)? != [0; 32],
            "acceptance nonce must be nonzero"
        );
        let grant = AcceptanceGrant {
            blinding: bytes32(&input.acceptance_nonce)?,
            predecessor: from_bytes(&note.utxo.utxo_hash)?,
            ordinal: decimal(&input.ordinal)?,
            memory,
            selected_procedure: input.selected_procedure,
            negative: input.feedback.negative,
            magnitude: input.feedback.magnitude,
        };
        let authorization = grant.commitment(&room)?;
        let address = self.writer.shielded_address()?;
        let mut records = InputRecords::new();
        let owner = *records.address(&address)?.owner();
        let program = AdvanceRoom {
            private: AdvanceRoomPrivateInputs {
                tx_context: InputRecords::context(
                    &spr_keypair::random_blinding(),
                    Some(self.config.tree_id),
                )?,
                checkpoint: records.utxo(&note.utxo)?,
                unique_address: from_bytes(
                    &note
                        .address
                        .ok_or_else(|| anyhow!("unique address absent"))?,
                )?,
                state: note.data,
                grant,
            },
            public: AdvanceRoomPublicInputs {
                room_owner: records
                    .address(&self.authority().address(self.writer.viewing_pubkey())?)?,
                writer_identity: owner.key().identity()?,
                room_identity: room,
                authorization,
            },
        };
        let transaction = records.create_program_transaction(
            &program,
            checked(|| program.execute())?,
            &address,
            self.writer.pubkey(),
        )?;
        self.prepare("advance_room", transaction, room, Some(authorization))
    }

    fn retained_transaction(&self, input: &SubmitInput) -> Result<VersionedTransaction> {
        let bytes = STANDARD.decode(&input.transaction_base64)?;
        ensure!(
            bytes.len() <= solana_message::v1::MAX_TRANSACTION_SIZE
                && digest(&bytes) == input.transaction_digest,
            "transaction bytes differ"
        );
        let transaction: VersionedTransaction = wincode::deserialize_exact(&bytes)?;
        transaction.sanitize()?;
        ensure!(transaction.signatures.len() == 1, "unexpected signer count");
        transaction.verify_and_hash_message()?;
        let VersionedMessage::V1(message) = &transaction.message else {
            return Err(anyhow!("unexpected transaction version"));
        };
        let keys = &message.account_keys;
        let instructions = &message.instructions;
        ensure!(
            keys.first() == Some(&self.writer.pubkey()) && instructions.len() == 1,
            "transaction differs from room shape"
        );
        ensure!(
            keys.get(instructions[0].program_id_index as usize) == Some(&ID),
            "unexpected application program"
        );
        let (tag, mut data) = instructions[0]
            .data
            .split_first()
            .ok_or_else(|| anyhow!("instruction absent"))?;
        let (proof, viewing_pubkey, room_identity, authorization) = match *tag {
            tag::CREATE_ROOM => {
                let args: CreateArgs = wincode::deserialize_from(&mut data)?;
                (args.proof, args.viewing_pubkey, args.room_identity, None)
            }
            tag::ADVANCE_ROOM => {
                let args: AdvanceArgs = wincode::deserialize_from(&mut data)?;
                (
                    args.proof,
                    args.viewing_pubkey,
                    args.room_identity,
                    Some(args.authorization),
                )
            }
            _ => return Err(anyhow!("unexpected application instruction")),
        };
        ensure!(
            viewing_pubkey == *self.writer.viewing_pubkey().as_bytes(),
            "unexpected viewing key"
        );
        let instruction = RoomInstruction {
            writer: self.writer.pubkey(),
            tree: Address::from_str(&self.config.tree_address)?,
            proof,
            viewing_pubkey,
            room_identity,
            transact: TransactIxData::deserialize(data)?,
        };
        let instruction = match authorization {
            Some(grant) => instruction.advance(grant)?,
            None => instruction.create()?,
        };
        let expected = compile_message(
            &self.writer.pubkey(),
            &[instruction],
            message.lifetime_specifier,
            ComputeBudgetConfig::new(1_400_000),
        )?;
        ensure!(
            expected.header() == &message.header
                && expected.static_account_keys() == keys
                && expected.instructions() == instructions,
            "application accounts or instruction differ"
        );
        Ok(transaction)
    }

    fn submission_state(&self, transaction: &VersionedTransaction) -> SubmissionState {
        let rpc = self.client.rpc().client();
        let signature = transaction.signatures[0];
        // Recheck history after expiry: acceptance may race the first lookup.
        for expired in [false, true] {
            let Ok(statuses) = rpc.get_signature_statuses_with_history(&[signature]) else {
                return SubmissionState::Unknown;
            };
            match statuses.value.as_slice() {
                [Some(status)]
                    if status.err.is_none()
                        && status.satisfies_commitment(CommitmentConfig::confirmed()) =>
                {
                    return SubmissionState::Confirmed(status.slot);
                }
                [None] => {}
                _ => return SubmissionState::Unknown,
            }
            if expired {
                return SubmissionState::Expired;
            }
            match rpc.is_blockhash_valid(
                transaction.message.recent_blockhash(),
                CommitmentConfig::confirmed(),
            ) {
                Ok(false) => {}
                Ok(true) => return SubmissionState::Live,
                Err(_) => return SubmissionState::Unknown,
            }
        }
        SubmissionState::Unknown
    }

    fn submit(&self, input: SubmitInput) -> Result<Value> {
        let transaction = self
            .retained_transaction(&input)
            .context(BridgeFailure::InvalidRequest)?;
        let state = self.submission_state(&transaction);
        if !matches!(state, SubmissionState::Live) {
            return Ok(state.response(&transaction));
        }
        let _ = self.client.process_transaction(transaction.clone());
        Ok(self.submission_state(&transaction).response(&transaction))
    }

    fn reframe(&self, input: SubmitInput) -> Result<Value> {
        let transaction = self
            .retained_transaction(&input)
            .context(BridgeFailure::InvalidRequest)?;
        match self.submission_state(&transaction) {
            SubmissionState::Expired => {}
            SubmissionState::Live => return Err(BridgeFailure::TransactionLive.into()),
            state => return Ok(state.response(&transaction)),
        }
        let Ok((blockhash, _)) = self.client.get_latest_blockhash() else {
            return Ok(SubmissionState::Unknown.response(&transaction));
        };
        if &blockhash == transaction.message.recent_blockhash() {
            return Ok(SubmissionState::Unknown.response(&transaction));
        }
        let mut message = transaction.message;
        message.set_recent_blockhash(blockhash);
        let reframed = sign_transaction(message, &[&self.writer])?;
        let bytes = wincode::serialize(&reframed)?;
        Ok(json!({
            "status": "reframed",
            "transactionBase64": STANDARD.encode(&bytes),
            "transactionDigest": digest(&bytes),
            "parentTransactionDigest": input.transaction_digest,
            "signature": reframed.signatures[0].to_string(),
        }))
    }

    fn recover(&self, input: RecoverInput) -> Result<Value> {
        let room = from_bytes(&bytes32(&input.room_id)?)?;
        let scan = self.recover_note(room, decimal(&input.minimum_confirmed_slot)?)?;
        let Some(note) = scan.note else {
            return Ok(
                json!({ "status": "not_found", "contextSlot": scan.context_slot.to_string() }),
            );
        };
        let memory = note.data.memory;
        let lesson = std::str::from_utf8(&memory.lesson[..memory.length as usize])?;
        Ok(
            json!({ "status": "recovered", "checkpoint": self.checkpoint(&note)?, "memory": {
            "lesson": lesson, "episodeCommitment": hex::encode(memory.episode), "originalResultCommitment": hex::encode(memory.original_result), "candidateCommitment": hex::encode(memory.candidate), "predecessorCommitment": hex::encode(to_bytes(&note.data.predecessor)), "authorizationCommitment": hex::encode(to_bytes(&note.data.authorization)),
        }, "policy": { "policyId": note.data.policy.id.to_string(), "scores": [note.data.policy.first, note.data.policy.second] }, "writerIdentity": self.writer.pubkey().to_string(), "seedManifestCommitment": hex::encode(note.data.seed_manifest), "fixedMembersCommitment": hex::encode(note.data.fixed_members), "signature": note.utxo.tx_signature.to_string(), "slot": note.utxo.slot.to_string(), "contextSlot": scan.context_slot.to_string(), "artifactVersion": ARTIFACT_VERSION }),
        )
    }
}

fn run(request: Request) -> Result<Value> {
    if request.protocol_version != VERSION
        || request.operation_id.is_empty()
        || request.operation_id.len() > 128
    {
        return Err(BridgeFailure::InvalidRequest.into());
    }
    let host = Host::load().context(BridgeFailure::ArtifactMismatch)?;
    let mut output = match request.op.as_str() {
        "prepare_create" => host.create(
            serde_json::from_value(request.input).context(BridgeFailure::InvalidRequest)?,
        )?,
        "prepare_advance" => host.advance(
            serde_json::from_value(request.input).context(BridgeFailure::InvalidRequest)?,
        )?,
        "submit" => host.submit(
            serde_json::from_value(request.input).context(BridgeFailure::InvalidRequest)?,
        )?,
        "reframe" => host.reframe(
            serde_json::from_value(request.input).context(BridgeFailure::InvalidRequest)?,
        )?,
        "recover" => host.recover(
            serde_json::from_value(request.input).context(BridgeFailure::InvalidRequest)?,
        )?,
        _ => return Err(BridgeFailure::InvalidRequest.into()),
    };
    output["protocolVersion"] = json!(VERSION);
    output["operationId"] = json!(request.operation_id);
    Ok(output)
}

#[derive(Debug)]
enum BridgeFailure {
    StateConflict,
    ArtifactMismatch,
    RecoveryUnavailable,
    ProofFailed,
    InvalidRequest,
    TransactionLive,
}

impl BridgeFailure {
    fn code(&self) -> &'static str {
        match self {
            Self::StateConflict => "state_conflict",
            Self::ArtifactMismatch => "artifact_mismatch",
            Self::RecoveryUnavailable => "recovery_unavailable",
            Self::ProofFailed => "proof_failed",
            Self::InvalidRequest => "invalid_request",
            Self::TransactionLive => "transaction_live",
        }
    }
}
impl std::fmt::Display for BridgeFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}
impl std::error::Error for BridgeFailure {}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let mut operation_id = String::new();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<Value> {
        let mut input = String::new();
        io::stdin()
            .take(65537)
            .read_to_string(&mut input)
            .context(BridgeFailure::InvalidRequest)?;
        if input.len() > 65536 {
            return Err(BridgeFailure::InvalidRequest.into());
        }
        let request: Request =
            serde_json::from_str(&input).context(BridgeFailure::InvalidRequest)?;
        operation_id = request.operation_id.clone();
        run(request)
    }));
    match result {
        Ok(Ok(output)) => println!("{output}"),
        failure => {
            let code = match &failure {
                Ok(Err(error)) => error
                    .downcast_ref::<BridgeFailure>()
                    .map(BridgeFailure::code)
                    .unwrap_or("operation_failed"),
                _ => "operation_failed",
            };
            println!(
                "{}",
                json!({ "protocolVersion": VERSION, "operationId": operation_id, "status": "error", "error": { "code": code } })
            );
            std::process::exit(1);
        }
    }
}
