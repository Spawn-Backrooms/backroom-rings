use super::*;
use solana_rpc_client::{api::request::RpcRequest, mock_sender::MocksMap, rpc_client::RpcClient};

fn config() -> Config {
    serde_json::from_value(json!({
        "signerSeedHex": "0".repeat(64),
        "rpcUrl":"http://127.0.0.1:1", "proverUrl":"http://127.0.0.1:2", "indexerUrl":"http://127.0.0.1:3",
        "treeAddress":spr_interface::pda::tree(0).to_string(), "treeId":0,
        "artifactsDirectory":"/unavailable-unit-test-artifacts",
        "genesisHash":"11111111111111111111111111111111",
        "programBinarySha256":digest(&[1,2,3]), "shieldedPoolBinarySha256":digest(&[1,2,3]),
    })).unwrap()
}

fn rpc(genesis: &str, owner: Address, executable: bool, bytes: &[u8]) -> SolanaRpc {
    let responses = [
        (RpcRequest::GetGenesisHash, json!(genesis)),
        (
            RpcRequest::GetAccountInfo,
            json!({"context":{"slot":1},"value":{"lamports":1,"owner":owner.to_string(),"executable":executable,"rentEpoch":0,"space":bytes.len(),"data":[STANDARD.encode(bytes),"base64"]}}),
        ),
    ];
    let mocks: MocksMap = (0..8).flat_map(|_| responses.clone()).collect();
    SolanaRpc::with_client(RpcClient::new_mock_with_mocks_map("succeeds", mocks))
}

#[test]
fn actual_rpc_genesis_and_both_program_bytes_are_bound() {
    let config = config();
    let network = rpc(
        &config.genesis_hash,
        solana_sdk_ids::bpf_loader::ID,
        true,
        &[1, 2, 3],
    );
    verify_deployment(&network, &config).unwrap();
    let mut wrong = config;
    wrong.genesis_hash = "other-ledger".into();
    assert!(verify_deployment(&network, &wrong)
        .unwrap_err()
        .to_string()
        .contains("genesis differs"));
    wrong.genesis_hash = "11111111111111111111111111111111".into();
    wrong.program_binary_sha256 = digest(&[9]);
    assert!(verify_deployment(&network, &wrong)
        .unwrap_err()
        .to_string()
        .contains("program binary differs"));
    wrong.program_binary_sha256 = digest(&[1, 2, 3]);
    wrong.shielded_pool_binary_sha256 = digest(&[9]);
    assert!(verify_deployment(&network, &wrong)
        .unwrap_err()
        .to_string()
        .contains("program binary differs"));
}

#[test]
fn production_refuses_loader_substitution_and_nonexecutable_programs() {
    let mut config = config();
    config.mode = DeploymentMode::Production;
    for (owner, executable) in [
        (solana_sdk_ids::system_program::ID, true),
        (solana_sdk_ids::bpf_loader::ID, false),
        (solana_sdk_ids::loader_v4::ID, true),
    ] {
        let network = rpc(&config.genesis_hash, owner, executable, &[1, 2, 3]);
        assert!(verify_deployment(&network, &config).is_err());
    }
}

#[test]
fn confidential_prover_rejects_plaintext_and_absent_policy_before_http() {
    for endpoint in [
        "http://127.0.0.1:1",
        "http://prover.invalid",
        "https://user:secret@prover.invalid",
        "https://prover.invalid?secret=1",
        "https://prover.invalid#fragment",
    ] {
        assert!(attested_prover(endpoint, b"{}").is_err());
    }
    for policy in [
        b"{}".as_slice(),
        br#"{"deployment":null}"#.as_slice(),
        br#"{"platform":"unknown"}"#.as_slice(),
    ] {
        assert!(attested_prover("https://prover.invalid", policy).is_err());
    }
}

#[test]
fn development_binary_never_claims_production_identity() {
    assert!(!PRODUCTION_BUILD);
    let identity = compiled_identity();
    assert_eq!(identity["production"], false);
    assert_eq!(
        identity["circuits"]["createRoom"]["insecureTestSetup"],
        true
    );
    assert_eq!(
        identity["circuits"]["advanceRoom"]["insecureTestSetup"],
        true
    );
}
