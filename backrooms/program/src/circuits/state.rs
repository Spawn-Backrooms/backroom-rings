use borsh::{BorshDeserialize, BorshSerialize};
use spr_program::circuit::DataHash;
use spr_program::{
    input, poseidon, require, require_eq, CircuitError, Field, UtxoOwner, UtxoState,
};

#[input]
#[derive(
    Default, PartialEq, Eq, BorshSerialize, BorshDeserialize, UtxoState, spr_program::ClientInputs,
)]
pub struct RoomBinding {
    pub schema: u64,
    pub deployment: u64,
    pub program_id: [u8; 32],
    pub creation_nonce: [u8; 32],
}

#[input]
#[derive(PartialEq, Eq, BorshSerialize, BorshDeserialize, UtxoState, spr_program::ClientInputs)]
pub struct AcceptedMemory {
    pub lesson: [u8; crate::LESSON_CAPACITY],
    pub length: u8,
    pub scope: u8,
    pub episode: [u8; 32],
    pub original_result: [u8; 32],
    pub candidate: [u8; 32],
}

impl Default for AcceptedMemory {
    fn default() -> Self {
        Self {
            lesson: [0; crate::LESSON_CAPACITY],
            length: 0,
            scope: 0,
            episode: [0; 32],
            original_result: [0; 32],
            candidate: [0; 32],
        }
    }
}

impl AcceptedMemory {
    pub fn validate(&self) {
        require(self.length <= crate::LESSON_CAPACITY as u8);
        require_eq(self.scope, 0);
        for i in 0..crate::LESSON_CAPACITY {
            require(i < self.length as usize || self.lesson[i] == 0);
        }
    }
}

#[input]
#[derive(
    Default, PartialEq, Eq, BorshSerialize, BorshDeserialize, UtxoState, spr_program::ClientInputs,
)]
pub struct LearnedPolicy {
    pub id: u64,
    pub first: u8,
    pub second: u8,
}

impl LearnedPolicy {
    pub fn validate(&self) {
        require_eq(self.id, crate::POLICY);
        require(self.first <= 100);
        require(self.second <= 100);
    }

    pub fn learn(&mut self, selected: u8, negative: bool, magnitude: u8) {
        self.validate();
        require(selected <= 1);
        require(magnitude <= 10);
        let old = if selected == 0 {
            self.first
        } else {
            self.second
        };
        let next = if negative {
            if old >= magnitude {
                old - magnitude
            } else {
                0
            }
        } else {
            let sum = old + magnitude;
            if sum > 100 {
                100
            } else {
                sum
            }
        };
        if selected == 0 {
            self.first = next;
        } else {
            self.second = next;
        }
    }
}

#[input]
#[derive(PartialEq, UtxoState, spr_program::ClientInputs)]
#[utxo_state(custom_codec)]
pub struct RoomStateV0 {
    pub binding: RoomBinding,
    pub seed_manifest: [u8; 32],
    pub fixed_members: [u8; 32],
    pub writer: UtxoOwner,
    pub revision: u64,
    pub memory: AcceptedMemory,
    pub policy: LearnedPolicy,
    pub predecessor: Field,
    pub authorization: Field,
}

impl Default for RoomStateV0 {
    fn default() -> Self {
        Self {
            binding: RoomBinding::default(),
            seed_manifest: [0; 32],
            fixed_members: [0; 32],
            writer: UtxoOwner::default(),
            revision: 0,
            memory: AcceptedMemory::default(),
            policy: LearnedPolicy::default(),
            predecessor: Field::zero(),
            authorization: Field::zero(),
        }
    }
}

impl RoomStateV0 {
    pub fn identity(&self) -> Result<Field, CircuitError> {
        poseidon(&[
            Field::from(0x4252524f4f4d5630u64),
            self.binding.hash()?,
            self.writer.key().identity()?,
        ])
    }

    pub fn validate(&self) {
        require_eq(self.binding.schema, crate::SCHEMA);
        require_eq(self.binding.deployment, crate::DEPLOYMENT);
        require_eq(self.binding.program_id, crate::PROGRAM_DOMAIN);
        self.memory.validate();
        self.policy.validate();
    }
}

#[cfg(not(xark))]
impl spr_program::EncryptionCodec for RoomStateV0 {
    fn serialize_for_encryption(&self) -> std::io::Result<Vec<u8>> {
        borsh::to_vec(&(
            self.binding,
            self.seed_manifest,
            self.fixed_members,
            self.writer,
            self.revision,
            self.memory,
            self.policy,
            spr_program::to_bytes(&self.predecessor),
            spr_program::to_bytes(&self.authorization),
        ))
    }

    fn deserialize_after_decryption(bytes: &[u8]) -> std::io::Result<Self> {
        type Encoded = (
            RoomBinding,
            [u8; 32],
            [u8; 32],
            UtxoOwner,
            u64,
            AcceptedMemory,
            LearnedPolicy,
            [u8; 32],
            [u8; 32],
        );
        let (
            binding,
            seed_manifest,
            fixed_members,
            writer,
            revision,
            memory,
            policy,
            predecessor,
            authorization,
        ) = Encoded::try_from_slice(bytes)?;
        let canonical = |bytes: [u8; 32]| {
            spr_program::from_bytes(&bytes).map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "noncanonical room commitment",
                )
            })
        };
        Ok(Self {
            binding,
            seed_manifest,
            fixed_members,
            writer,
            revision,
            memory,
            policy,
            predecessor: canonical(predecessor)?,
            authorization: canonical(authorization)?,
        })
    }
}

#[cfg(xark)]
impl spr_program::EncryptionCodec for RoomStateV0 {
    fn serialize_for_encryption(&self) -> std::io::Result<Vec<u8>> {
        Err(std::io::Error::other(
            "circuit execution does not serialize state",
        ))
    }
    fn deserialize_after_decryption(_: &[u8]) -> std::io::Result<Self> {
        Err(std::io::Error::other(
            "circuit execution does not decrypt state",
        ))
    }
}
