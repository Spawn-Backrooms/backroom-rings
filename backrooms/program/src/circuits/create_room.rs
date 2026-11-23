use super::{AcceptedMemory, LearnedPolicy, RoomBinding, RoomStateV0};
use spr_program::circuit::{
    CheckedTransaction, ConfidentialTransaction, PublicInputs, UniqueDataUtxo,
};
use spr_program::{
    input, require_eq, CircuitError, Field, ShieldedAddress, TxContext, UtxoOwner, ZkProgram,
};

#[input]
#[derive(ZkProgram)]
pub struct CreateRoom {
    pub private: CreateRoomPrivateInputs,
    pub public: CreateRoomPublicInputs,
}

#[input]
#[derive(spr_program::ClientInputs)]
pub struct CreateRoomPrivateInputs {
    pub tx_context: TxContext,
    pub creation_nonce: [u8; 32],
    pub seed_manifest: [u8; 32],
    pub fixed_members: [u8; 32],
    pub writer: UtxoOwner,
}

#[input]
#[derive(PublicInputs)]
pub struct CreateRoomPublicInputs {
    pub room_owner: ShieldedAddress,
    pub writer_identity: Field,
    pub room_identity: Field,
}

impl CreateRoom {
    pub fn execute(&self) -> Result<CheckedTransaction, CircuitError> {
        require_eq(
            self.private.writer.key().identity()?,
            self.public.writer_identity,
        );
        let state = RoomStateV0 {
            binding: RoomBinding {
                schema: crate::SCHEMA,
                deployment: crate::DEPLOYMENT,
                program_id: crate::PROGRAM_DOMAIN,
                creation_nonce: self.private.creation_nonce,
            },
            seed_manifest: self.private.seed_manifest,
            fixed_members: self.private.fixed_members,
            writer: self.private.writer,
            revision: 0,
            memory: AcceptedMemory::default(),
            policy: LearnedPolicy {
                id: crate::POLICY,
                first: 50,
                second: 50,
            },
            predecessor: Field::zero(),
            authorization: Field::zero(),
        };
        require_eq(state.identity()?, self.public.room_identity);
        let mut room =
            UniqueDataUtxo::new_init(self.public.room_owner.owner(), &self.public.room_identity)?;
        *room = state;
        ConfidentialTransaction::new(&self.private.tx_context, &self.public)
            .with(room)
            .check()
    }
}
