use anyhow::{ensure, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_commitment_config::CommitmentConfig;
use solana_message::VersionedMessage;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use spr_client::sign_transaction;
use spr_program_test::{
    fixture,
    localnet::{FixtureLocalnet, LocalnetPaths, LocalnetPorts},
    workspace_path,
};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread::sleep,
    time::{Duration, Instant},
};

struct Bridge {
    config_path: PathBuf,
}

impl Bridge {
    fn call(&self, op: &str, input: Value) -> Result<Value> {
        let request = json!({
            "protocolVersion": "backrooms.v0",
            "operationId": format!("expiry-test-{op}"),
            "op": op,
            "input": input,
        });
        let mut process = Command::new(env!("CARGO_BIN_EXE_backroom-rings-bridge"))
            .env("BACKROOM_RINGS_CONFIG", &self.config_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        serde_json::to_writer(process.stdin.take().unwrap(), &request)?;
        let output = process.wait_with_output()?;
        let response: Value = serde_json::from_slice(&output.stdout)?;
        assert_eq!(response["protocolVersion"], "backrooms.v0");
        assert_eq!(response["operationId"], request["operationId"]);
        assert_eq!(output.status.success(), response["status"] != "error");
        Ok(response)
    }
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn retained(response: &Value) -> Value {
    json!({
        "transactionBase64": response["transactionBase64"],
        "transactionDigest": response["transactionDigest"],
    })
}

fn decode(response: &Value) -> Result<VersionedTransaction> {
    Ok(wincode::deserialize_exact(&STANDARD.decode(
        response["transactionBase64"].as_str().unwrap(),
    )?)?)
}

fn encode(transaction: &VersionedTransaction) -> Result<Value> {
    let bytes = wincode::serialize(transaction)?;
    Ok(json!({
        "transactionBase64": STANDARD.encode(&bytes),
        "transactionDigest": digest(&bytes),
    }))
}

#[track_caller]
fn expect_error(response: Value, code: &str) {
    assert_eq!(response["status"], "error", "{response}");
    assert_eq!(response["error"]["code"], code, "{response}");
}

fn expire(localnet: &FixtureLocalnet, transaction: &VersionedTransaction) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(60);
    while localnet.client.rpc().client().is_blockhash_valid(
        transaction.message.recent_blockhash(),
        CommitmentConfig::confirmed(),
    )? {
        ensure!(Instant::now() < deadline, "local blockhash did not expire");
        sleep(Duration::from_millis(100));
    }
    Ok(())
}

fn retain_before_submit(path: &Path, response: &Value) -> Result<()> {
    let mut file = fs::File::create(path)?;
    serde_json::to_writer(&mut file, response)?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

fn assert_only_frame_changed(parent: &Value, reframed: &Value) -> Result<()> {
    assert_eq!(reframed["status"], "reframed", "{reframed}");
    assert_eq!(
        reframed["parentTransactionDigest"],
        parent["transactionDigest"]
    );
    assert_ne!(reframed["transactionDigest"], parent["transactionDigest"]);
    let original = decode(parent)?;
    let changed = decode(reframed)?;
    original.verify_and_hash_message()?;
    changed.verify_and_hash_message()?;
    assert_ne!(original.signatures, changed.signatures);
    assert_ne!(
        original.message.recent_blockhash(),
        changed.message.recent_blockhash()
    );
    let mut restored = changed.message;
    restored.set_recent_blockhash(*original.message.recent_blockhash());
    assert_eq!(restored, original.message);
    Ok(())
}

#[test]
fn expired_genesis_and_advance_reframe_without_changing_the_authorized_checkpoint() -> Result<()> {
    let paths = LocalnetPaths::workspace();
    let ports = LocalnetPorts::for_test(14)?;
    let program = workspace_path("target/deploy/backroom_rings_program.so");
    let localnet = FixtureLocalnet::start(
        "backrooms-expiry",
        ports,
        vec![(backroom_rings_program::ID, program.clone())],
        &paths,
    )?;
    let directory = paths
        .scratch_dir
        .join(format!("backrooms-expiry-{}", ports.rpc));
    let config_path = directory.join("bridge-config.json");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let config_file = options.open(&config_path)?;
    serde_json::to_writer(
        config_file,
        &json!({
            "signerSeedHex": hex::encode(&fixture::actor(0).to_bytes()[..32]),
            "rpcUrl": ports.rpc_url(),
            "indexerUrl": ports.photon_url(),
            "proverUrl": std::env::var("ZOLANA_PROVER_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:3001".into()),
            "treeAddress": localnet.tree.to_string(),
            "treeId": localnet.tree_id,
            "artifactsDirectory": workspace_path("target/zk/backroom-rings-program"),
            "genesisHash": localnet.client.rpc().client().get_genesis_hash()?.to_string(),
            "programBinarySha256": digest(&fs::read(program)?),
            "shieldedPoolBinarySha256": digest(&fs::read(&paths.shielded_pool_program)?),
        }),
    )?;
    let bridge = Bridge { config_path };
    let create = bridge.call(
        "prepare_create",
        json!({
            "creationNonce": "ab".repeat(32),
            "seedManifestCommitment": "cd".repeat(32),
            "fixedMembersCommitment": "ef".repeat(32),
        }),
    )?;
    assert_eq!(create["status"], "prepared", "{create}");

    expect_error(
        bridge.call("reframe", retained(&create))?,
        "transaction_live",
    );
    let original = decode(&create)?;
    let mut invalid_signature = original.clone();
    invalid_signature.signatures[0] = fixture::actor(1).sign_message(&original.message.serialize());
    expect_error(
        bridge.call("reframe", encode(&invalid_signature)?)?,
        "invalid_request",
    );
    let mut wrong_tag = original.clone();
    let VersionedMessage::V1(message) = &mut wrong_tag.message else {
        panic!("bridge prepares v1 messages");
    };
    message.instructions[0].data[0] = 255;
    let wrong_tag = sign_transaction(wrong_tag.message, &[&fixture::actor(0)])?;
    expect_error(
        bridge.call("reframe", encode(&wrong_tag)?)?,
        "invalid_request",
    );
    let mut wrong_account = original.clone();
    let VersionedMessage::V1(message) = &mut wrong_account.message else {
        panic!("bridge prepares v1 messages");
    };
    let index = message
        .account_keys
        .iter()
        .position(|key| key == &localnet.tree)
        .unwrap();
    message.account_keys[index] = fixture::actor(1).pubkey();
    let wrong_account = sign_transaction(wrong_account.message, &[&fixture::actor(0)])?;
    expect_error(
        bridge.call("reframe", encode(&wrong_account)?)?,
        "invalid_request",
    );

    let mut with_fee = original.message;
    let VersionedMessage::V1(message) = &mut with_fee else {
        panic!("bridge prepares v1 messages");
    };
    message.config = message.config.with_priority_fee(17);
    let with_fee = sign_transaction(with_fee, &[&fixture::actor(0)])?;
    let parent = encode(&with_fee)?;
    retain_before_submit(&directory.join("create-parent.json"), &parent)?;
    expire(&localnet, &with_fee)?;
    let expired = bridge.call("submit", parent.clone())?;
    assert_eq!(expired["status"], "expired", "{expired}");
    let missing = bridge.call(
        "recover",
        json!({ "roomId": create["checkpoint"]["roomId"], "minimumConfirmedSlot": "0" }),
    )?;
    assert_eq!(missing["status"], "not_found", "{missing}");
    let reframed = bridge.call("reframe", parent.clone())?;
    assert_only_frame_changed(&parent, &reframed)?;
    retain_before_submit(&directory.join("create-reframed.json"), &reframed)?;
    let created = bridge.call("submit", retained(&reframed))?;
    assert_eq!(created["status"], "confirmed", "{created}");
    let confirmed_again = bridge.call("reframe", retained(&reframed))?;
    assert_eq!(
        confirmed_again,
        json!({
            "protocolVersion": "backrooms.v0", "operationId": "expiry-test-reframe",
            "status": "confirmed", "signature": created["signature"], "slot": created["slot"],
        })
    );
    let recovered = bridge.call(
        "recover",
        json!({ "roomId": create["checkpoint"]["roomId"], "minimumConfirmedSlot": created["slot"] }),
    )?;
    assert_eq!(recovered["checkpoint"], create["checkpoint"]);

    let advance = bridge.call(
        "prepare_advance",
        json!({
            "roomId": create["checkpoint"]["roomId"],
            "expectedPredecessor": create["checkpoint"]["stateCommitment"],
            "ordinal": "1", "acceptanceNonce": "98".repeat(32),
            "episodeCommitment": "12".repeat(32),
            "originalResultCommitment": "34".repeat(32),
            "candidateCommitment": "56".repeat(32),
            "lesson": "Check assumptions", "selectedProcedure": 0,
            "feedback": { "negative": true, "magnitude": 10 },
            "minimumConfirmedSlot": created["slot"],
        }),
    )?;
    assert_eq!(advance["status"], "prepared", "{advance}");
    retain_before_submit(&directory.join("advance-parent.json"), &advance)?;
    expire(&localnet, &decode(&advance)?)?;
    let expired = bridge.call("submit", retained(&advance))?;
    assert_eq!(expired["status"], "expired", "{expired}");
    let unchanged = bridge.call(
        "recover",
        json!({
            "roomId": create["checkpoint"]["roomId"], "minimumConfirmedSlot": created["slot"],
        }),
    )?;
    assert_eq!(unchanged["checkpoint"], create["checkpoint"]);
    let reframed = bridge.call("reframe", retained(&advance))?;
    assert_only_frame_changed(&advance, &reframed)?;
    retain_before_submit(&directory.join("advance-reframed.json"), &reframed)?;
    let accepted = bridge.call("submit", retained(&reframed))?;
    assert_eq!(accepted["status"], "confirmed", "{accepted}");
    let learned = bridge.call(
        "recover",
        json!({
            "roomId": create["checkpoint"]["roomId"], "minimumConfirmedSlot": accepted["slot"],
        }),
    )?;
    assert_eq!(learned["checkpoint"], advance["checkpoint"]);
    assert_eq!(
        learned["memory"]["authorizationCommitment"],
        advance["authorizationCommitment"]
    );
    assert_eq!(learned["memory"]["lesson"], "Check assumptions");
    assert_eq!(learned["memory"]["episodeCommitment"], "12".repeat(32));
    assert_eq!(
        learned["memory"]["originalResultCommitment"],
        "34".repeat(32)
    );
    assert_eq!(learned["memory"]["candidateCommitment"], "56".repeat(32));
    assert_eq!(learned["policy"]["scores"], json!([40, 50]));
    eprintln!("expired genesis and advance reframed: identical authorized checkpoints recovered");
    Ok(())
}
