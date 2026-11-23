use super::{AcceptedMemory, RoomStateV0};
use spr_program::circuit::{
    CheckedTransaction, ConfidentialTransaction, DataHash, PublicInputs, UniqueDataUtxo, Utxo,
};
use spr_program::{
    input, poseidon, require, require_eq, CircuitError, Field, ShieldedAddress, TxContext,
    ZkProgram,
};

#[input]
#[derive(spr_program::ClientInputs)]
pub struct AcceptanceGrant {
    pub predecessor: Field,
    pub blinding: [u8; 32],
    pub ordinal: u64,
    pub memory: AcceptedMemory,
    pub selected_procedure: u8,
    pub negative: bool,
    pub magnitude: u8,
}

impl AcceptanceGrant {
    pub fn commitment(&self, room: &Field) -> Result<Field, CircuitError> {
        poseidon(&[
            Field::from(0x4252414343455054u64),
            *room,
            self.predecessor,
            Field::from(self.ordinal),
            self.memory.hash()?,
            Field::from(self.selected_procedure),
            Field::from(self.negative),
            Field::from(self.magnitude),
            self.blinding.hash()?,
        ])
    }
}

#[input]
#[derive(ZkProgram)]
pub struct AdvanceRoom {
    pub private: AdvanceRoomPrivateInputs,
    pub public: AdvanceRoomPublicInputs,
}

#[input]
#[derive(spr_program::ClientInputs)]
pub struct AdvanceRoomPrivateInputs {
    pub tx_context: TxContext,
    pub checkpoint: Utxo,
    pub unique_address: Field,
    pub state: RoomStateV0,
    pub grant: AcceptanceGrant,
}

#[input]
#[derive(PublicInputs)]
pub struct AdvanceRoomPublicInputs {
    pub room_owner: ShieldedAddress,
    pub writer_identity: Field,
    pub room_identity: Field,
    pub authorization: Field,
}

impl AdvanceRoom {
    pub fn execute(&self) -> Result<CheckedTransaction, CircuitError> {
        let old = &self.private.state;
        let grant = &self.private.grant;
        old.validate();
        require_eq(old.writer.key().identity()?, self.public.writer_identity);
        require_eq(old.identity()?, self.public.room_identity);
        require_eq(
            self.private.checkpoint.owner.hash()?,
            self.public.room_owner.owner().hash()?,
        );
        require_eq(self.private.checkpoint.amount, 0);
        require_eq(grant.predecessor, self.private.checkpoint.hash()?);
        require(old.revision < u64::MAX);
        require_eq(grant.ordinal, old.revision + 1);
        require_eq(
            grant.commitment(&self.public.room_identity)?,
            self.public.authorization,
        );
        grant.memory.validate();
        require(grant.memory.length > 0);
        let mut room =
            UniqueDataUtxo::new_mut(&self.private.checkpoint, &self.private.unique_address, old)?;
        room.revision = grant.ordinal;
        room.memory = grant.memory;
        room.predecessor = grant.predecessor;
        room.authorization = self.public.authorization;
        room.policy
            .learn(grant.selected_procedure, grant.negative, grant.magnitude);
        ConfidentialTransaction::new(&self.private.tx_context, &self.public)
            .with(room)
            .check()
    }
}
