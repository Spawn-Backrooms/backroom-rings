mod support;
use anyhow::Result;
use backroom_rings_program::{circuits::*, client::RoomInstruction};
use solana_instruction::Instruction;
use solana_signer::Signer;
use spr_client::{
    ClientError, ComputeBudgetConfig, IndexerRpcConfig, ProofDataSource, ProverClient, Rpc,
    SolanaRpc, SprClient, SprIndexer,
};
use spr_keypair::ShieldedKeypair;
use spr_program::{
    proof::compressed_proof, to_bytes, DataUtxo, InputRecords, ProgramOwner, ProgramTransaction,
};
use spr_program_test::{
    fixture,
    localnet::{FixtureLocalnet, LocalnetPaths, LocalnetPorts},
    workspace_path,
};
use spr_transaction::AssetRegistry;

fn prove(
    localnet: &FixtureLocalnet,
    writer: &ShieldedKeypair,
    name: &str,
    transaction: ProgramTransaction,
    room: [u8; 32],
    authorization: Option<[u8; 32]>,
) -> Result<Instruction> {
    let result = xark::prover::circuit_at(workspace_path(&format!(
        "target/zk/backroom-rings-program/{name}"
    )))
    .prove(transaction.proof_inputs)?;
    let proof = compressed_proof(&result.proof).map_err(anyhow::Error::msg)?;
    let encrypted = transaction.finalized.encrypt_with_keys(writer)?;
    let transact =
        localnet
            .client
            .prove_transact(encrypted, None, &ProgramOwner::nullifier_key())?;
    let builder = RoomInstruction {
        writer: writer.pubkey(),
        tree: localnet.tree,
        proof,
        viewing_pubkey: *writer.viewing_pubkey().as_bytes(),
        room_identity: room,
        transact,
    };
    Ok(match authorization {
        Some(grant) => builder.advance(grant)?,
        None => builder.create()?,
    })
}

fn send(
    localnet: &FixtureLocalnet,
    signer: &dyn Signer,
    instruction: Instruction,
    priority: u64,
) -> Result<u64, ClientError> {
    let (blockhash, _) = localnet.client.get_latest_blockhash()?;
    let message = spr_client::compile_message(
        &signer.pubkey(),
        &[instruction],
        blockhash,
        ComputeBudgetConfig::new(1_400_000).with_priority_fee(priority),
    )?;
    let signed = spr_client::sign_transaction(message, &[signer])?;
    let encoded = wincode::serialize(&signed).expect("signed v1 transaction encodes");
    assert!(encoded.len() <= solana_message::v1::MAX_TRANSACTION_SIZE);
    eprintln!("backrooms signed transaction bytes: {}", encoded.len());
    let signature = localnet.client.process_transaction(signed)?;
    Ok(localnet
        .client
        .get_signature_statuses(vec![signature])?
        .first()
        .and_then(Option::as_ref)
        .expect("confirmed transaction has status")
        .slot)
}

fn recover(
    client: &SprClient<SolanaRpc>,
    writer: &ShieldedKeypair,
    slot: u64,
) -> Result<Vec<DataUtxo<RoomStateV0>>> {
    let authority = room_authority(&writer.pubkey());
    let mut transactions = Vec::new();
    let mut cursor = None;
    let mut pages = 0;
    loop {
        let page = client.get_shielded_transactions_by_tags(
            vec![authority.confidential_view_tag()],
            cursor,
            Some(1),
            spr_client::HistoryFilters::default(),
            Some(IndexerRpcConfig::at_slot(slot)),
        )?;
        assert!(page.context.slot >= slot);
        transactions.extend(page.data.into_iter().flat_map(|entry| entry.events));
        pages += 1;
        match page.pagination_token {
            Some(next) => {
                assert_ne!(Some(next), cursor);
                cursor = Some(next);
            }
            None => break,
        }
    }
    assert!(pages > 0);
    Ok(authority.decrypt_data_utxos::<RoomStateV0>(
        &writer.viewing_key,
        &transactions,
        &AssetRegistry::default(),
    )?)
}

fn assert_program_error(error: ClientError, code: u32) {
    let transaction = match &error {
        ClientError::SolanaRpcTransaction { source, .. } => source.get_transaction_error(),
        _ => None,
    };
    assert_eq!(
        transaction,
        Some(
            solana_transaction_error::TransactionError::InstructionError(
                0,
                solana_instruction_error::InstructionError::Custom(code)
            )
        ),
        "{error}"
    );
}

#[test]
fn private_zero_value_learning_recovers_and_rejects_freshly_signed_replays() -> Result<()> {
    let ports = LocalnetPorts::for_test(12)?;
    let localnet = FixtureLocalnet::start(
        "backrooms-v0",
        ports,
        vec![(
            backroom_rings_program::ID,
            workspace_path("target/deploy/backroom_rings_program.so"),
        )],
        &LocalnetPaths::workspace(),
    )?;
    let writer = ShieldedKeypair::from_keypair(&fixture::actor(0))?;
    let fixture = support::fixture_with_writer(writer);
    let room = to_bytes(&fixture.create.public.room_identity);
    let genesis = prove(
        &localnet,
        &fixture.writer,
        "create_room",
        fixture.genesis(),
        room,
        None,
    )?;
    let genesis_slot = send(&localnet, &fixture.writer, genesis, 0)?;
    let mut notes = recover(&localnet.client, &fixture.writer, genesis_slot)?;
    assert_eq!(notes.len(), 1);
    let initial = notes.remove(0);
    assert_eq!(initial.utxo.utxo.amount, 0);
    assert_eq!(
        (initial.data.policy.first, initial.data.policy.second),
        (50, 50)
    );
    let (advance, records) = fixture.advance_from_note(initial.clone());
    let transaction = fixture.advance_transaction(&advance, &records);
    let accepted = prove(
        &localnet,
        &fixture.writer,
        "advance_room",
        transaction,
        room,
        Some(to_bytes(&advance.public.authorization)),
    )?;

    let mut wrong_signer = accepted.clone();
    let intruder = fixture::actor(1);
    for account in &mut wrong_signer.accounts {
        if account.pubkey == fixture.writer.pubkey() {
            account.pubkey = intruder.pubkey();
        }
    }
    assert_program_error(
        send(&localnet, &intruder, wrong_signer, 1).unwrap_err(),
        backroom_rings_program::error::RoomError::InvalidProof as u32,
    );

    let (mut other, other_records) = fixture.advance_from_note(initial);
    other.private.tx_context = InputRecords::context(&[22; 32], Some(localnet.tree_id))?;
    let other_transaction = fixture.advance_transaction(&other, &other_records);
    let mut mixed = prove(
        &localnet,
        &fixture.writer,
        "advance_room",
        other_transaction,
        room,
        Some(to_bytes(&other.public.authorization)),
    )?;
    let mut remaining = &accepted.data[1..];
    let _: backroom_rings_program::instructions::AdvanceArgs =
        wincode::deserialize_from(&mut remaining)?;
    let prefix = accepted.data.len() - remaining.len();
    mixed.data[..prefix].copy_from_slice(&accepted.data[..prefix]);
    assert_program_error(
        send(&localnet, &fixture.writer, mixed, 2).unwrap_err(),
        backroom_rings_program::error::RoomError::InvalidProof as u32,
    );

    let successor_slot = send(&localnet, &fixture.writer, accepted.clone(), 3)?;
    let fresh_client = SprClient::new(
        SolanaRpc::new(ports.rpc_url()),
        SprIndexer::new(ports.photon_url()),
        ProverClient::default(),
    )
    .with_proof_data_source(ProofDataSource::Client);
    let notes = recover(&fresh_client, &fixture.writer, successor_slot)?;
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].data.revision, 1);
    assert_eq!(
        (notes[0].data.policy.first, notes[0].data.policy.second),
        (40, 50)
    );
    assert_eq!(notes[0].data.memory, advance.private.grant.memory);
    assert_program_error(
        send(&localnet, &fixture.writer, accepted, 4).unwrap_err(),
        spr_interface::error::ShieldedPoolError::NullifierAlreadyQueued as u32,
    );
    Ok(())
}
