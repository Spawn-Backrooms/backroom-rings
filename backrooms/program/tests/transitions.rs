mod support;
use backroom_rings_program::circuits::*;
use spr_program::{checked, DataUtxo, EncryptionCodec, Field};
use support::fixture;

#[test]
fn zero_value_genesis_has_one_reserved_address_and_one_private_checkpoint() {
    let fixture = fixture();
    let transaction = fixture.genesis();
    assert_eq!(transaction.finalized.input_utxos().len(), 1);
    assert!(transaction.finalized.input_utxos()[0].is_address());
    assert_eq!(
        transaction
            .finalized
            .output_utxos()
            .iter()
            .filter(|output| output.data.utxo_data().is_some())
            .count(),
        1
    );
    assert!(transaction.finalized.output_utxos()[1..]
        .iter()
        .all(|output| output.compact && output.amount == 0));
    let output = &transaction.finalized.output_utxos()[0];
    assert_eq!(output.amount, 0);
    assert!(output.data.utxo_data().is_some());
    let authority = room_authority(
        &fixture
            .writer
            .shielded_address()
            .unwrap()
            .solana_address()
            .unwrap(),
    );
    let decoded =
        DataUtxo::<RoomStateV0>::try_from(authority.input(output, 0, 0).unwrap()).unwrap();
    assert!(decoded.address.is_some());
    assert_eq!(decoded.data.revision, 0);
    assert_eq!(
        (decoded.data.policy.first, decoded.data.policy.second),
        (50, 50)
    );
}

#[test]
fn learning_consumes_the_exact_checkpoint_and_preserves_room_bindings() {
    let fixture = fixture();
    let (advance, records) = fixture.advance();
    let old = advance.private.state;
    let transaction = fixture.advance_transaction(&advance, &records);
    assert_eq!(transaction.finalized.input_utxos().len(), 1);
    assert_eq!(
        transaction
            .finalized
            .output_utxos()
            .iter()
            .filter(|output| output.data.utxo_data().is_some())
            .count(),
        1
    );
    assert!(transaction.finalized.output_utxos()[1..]
        .iter()
        .all(|output| output.compact && output.amount == 0));
    let authority = room_authority(
        &fixture
            .writer
            .shielded_address()
            .unwrap()
            .solana_address()
            .unwrap(),
    );
    let decoded = DataUtxo::<RoomStateV0>::try_from(
        authority
            .input(&transaction.finalized.output_utxos()[0], 0, 1)
            .unwrap(),
    )
    .unwrap();
    let next = decoded.data;
    assert_eq!(next.binding, old.binding);
    assert_eq!(next.writer, old.writer);
    assert_eq!(next.seed_manifest, old.seed_manifest);
    assert_eq!(next.fixed_members, old.fixed_members);
    assert_eq!(next.revision, 1);
    assert_eq!((next.policy.first, next.policy.second), (40, 50));
    assert_eq!(next.memory, advance.private.grant.memory);
    assert_eq!(next.predecessor, advance.private.checkpoint.hash().unwrap());
    assert_eq!(next.authorization, advance.public.authorization);
}

#[test]
fn grant_cannot_be_rebound_to_another_predecessor_ordinal_room_or_result() {
    let fixture = fixture();
    for mutation in 0..10 {
        let (mut advance, _) = fixture.advance();
        match mutation {
            0 => advance.private.grant.predecessor += Field::one(),
            1 => advance.private.grant.ordinal += 1,
            2 => advance.public.room_identity += Field::one(),
            3 => advance.private.grant.memory.original_result[0] ^= 1,
            4 => advance.private.grant.memory.candidate[0] ^= 1,
            5 => advance.private.grant.memory.episode[0] ^= 1,
            6 => advance.public.writer_identity += Field::one(),
            7 => advance.private.grant.blinding[0] ^= 1,
            8 => advance.private.state.binding.deployment += 1,
            _ => advance.private.state.binding.program_id[0] ^= 1,
        }
        assert!(
            checked(|| advance.execute()).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn a_changed_state_or_unique_address_cannot_consume_a_valid_checkpoint() {
    let fixture = fixture();
    let (mut advance, _) = fixture.advance();
    advance.private.state.seed_manifest[0] ^= 1;
    assert!(checked(|| advance.execute()).is_err());
    let (mut advance, _) = fixture.advance();
    advance.private.unique_address += Field::one();
    assert!(checked(|| advance.execute()).is_err());
}

#[test]
fn policy_update_saturates_and_rejects_out_of_range_feedback() {
    for (start, negative, expected) in [
        (95, false, 100),
        (5, true, 0),
        (50, false, 60),
        (50, true, 40),
    ] {
        let mut policy = LearnedPolicy {
            id: 1,
            first: start,
            second: 61,
        };
        checked(|| {
            policy.learn(0, negative, 10);
            Ok(())
        })
        .unwrap();
        assert_eq!((policy.first, policy.second), (expected, 61));
    }
    for (selected, magnitude, score) in [(2, 1, 50), (0, 11, 50), (0, 1, 101)] {
        let mut policy = LearnedPolicy {
            id: 1,
            first: score,
            second: 50,
        };
        assert!(checked(|| {
            policy.learn(selected, false, magnitude);
            Ok(())
        })
        .is_err());
    }
}

#[test]
fn recovery_rejects_payload_changes_instead_of_accepting_plaintext() {
    let fixture = fixture();
    let transaction = fixture.genesis();
    let authority = room_authority(
        &fixture
            .writer
            .shielded_address()
            .unwrap()
            .solana_address()
            .unwrap(),
    );
    let mut wallet = authority
        .input(&transaction.finalized.output_utxos()[0], 0, 0)
        .unwrap();
    let decoded = DataUtxo::<RoomStateV0>::try_from(wallet.clone()).unwrap();
    let mut changed = decoded.data;
    changed.policy.first = 99;
    let mut bytes = decoded.address.unwrap().to_vec();
    bytes.extend(changed.serialize_for_encryption().unwrap());
    wallet.utxo.data =
        spr_transaction::Data::new(vec![spr_transaction::DataRecord::UtxoData(bytes)]);
    assert!(DataUtxo::<RoomStateV0>::try_from(wallet).is_err());
}
