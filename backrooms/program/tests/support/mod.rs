use backroom_rings_program::circuits::*;
use spr_keypair::{ShieldedKeypair, SigningKey};
use spr_program::{checked, from_bytes, DataUtxo, InputRecords, ProgramTransaction};

pub struct Fixture {
    pub writer: ShieldedKeypair,
    pub create: CreateRoom,
    pub create_records: InputRecords,
}

pub fn fixture() -> Fixture {
    let writer = ShieldedKeypair::from_keypair(SigningKey::from_ed25519_bytes(&[7; 32])).unwrap();
    fixture_with_writer(writer)
}

pub fn fixture_with_writer(writer: ShieldedKeypair) -> Fixture {
    let address = writer.shielded_address().unwrap();
    let payer = address.solana_address().unwrap();
    let authority = room_authority(&payer);
    let mut records = InputRecords::new();
    let owner = *records.address(&address).unwrap().owner();
    let binding = RoomBinding {
        schema: 0,
        deployment: backroom_rings_program::DEPLOYMENT,
        program_id: backroom_rings_program::PROGRAM_DOMAIN,
        creation_nonce: [8; 32],
    };
    let identity = RoomStateV0 {
        binding,
        writer: owner,
        ..Default::default()
    }
    .identity()
    .unwrap();
    let create = CreateRoom {
        private: CreateRoomPrivateInputs {
            tx_context: InputRecords::context(&[9; 32], Some(0)).unwrap(),
            creation_nonce: binding.creation_nonce,
            seed_manifest: [10; 32],
            fixed_members: [11; 32],
            writer: owner,
        },
        public: CreateRoomPublicInputs {
            room_owner: records
                .address(&authority.address(writer.viewing_pubkey()).unwrap())
                .unwrap(),
            writer_identity: owner.key().identity().unwrap(),
            room_identity: identity,
        },
    };
    Fixture {
        writer,
        create,
        create_records: records,
    }
}

impl Fixture {
    pub fn genesis(&self) -> ProgramTransaction {
        let address = self.writer.shielded_address().unwrap();
        self.create_records
            .create_program_transaction(
                &self.create,
                checked(|| self.create.execute()).unwrap(),
                &address,
                address.solana_address().unwrap(),
            )
            .unwrap()
    }

    pub fn advance(&self) -> (AdvanceRoom, InputRecords) {
        let genesis = self.genesis();
        let address = self.writer.shielded_address().unwrap();
        let authority = room_authority(&address.solana_address().unwrap());
        let wallet = authority
            .input(&genesis.finalized.output_utxos()[0], 0, 0)
            .unwrap();
        let decoded = DataUtxo::<RoomStateV0>::try_from(wallet.clone()).unwrap();
        self.advance_from_note(decoded)
    }

    pub fn advance_from_note(&self, decoded: DataUtxo<RoomStateV0>) -> (AdvanceRoom, InputRecords) {
        let wallet = decoded.utxo.clone();
        let authority = room_authority(
            &self
                .writer
                .shielded_address()
                .unwrap()
                .solana_address()
                .unwrap(),
        );
        let mut records = InputRecords::new();
        let predecessor = from_bytes(&wallet.utxo_hash).unwrap();
        let mut memory = AcceptedMemory {
            length: 17,
            episode: [12; 32],
            original_result: [13; 32],
            candidate: [14; 32],
            ..Default::default()
        };
        memory.lesson[..17].copy_from_slice(b"Check assumptions");
        let grant = AcceptanceGrant {
            predecessor,
            blinding: [16; 32],
            ordinal: 1,
            memory,
            selected_procedure: 0,
            negative: true,
            magnitude: 10,
        };
        let program = AdvanceRoom {
            private: AdvanceRoomPrivateInputs {
                tx_context: InputRecords::context(&[15; 32], Some(0)).unwrap(),
                checkpoint: records.utxo(&wallet).unwrap(),
                unique_address: from_bytes(&decoded.address.unwrap()).unwrap(),
                state: decoded.data,
                grant,
            },
            public: AdvanceRoomPublicInputs {
                room_owner: records
                    .address(&authority.address(self.writer.viewing_pubkey()).unwrap())
                    .unwrap(),
                writer_identity: self.create.public.writer_identity,
                room_identity: self.create.public.room_identity,
                authorization: grant.commitment(&self.create.public.room_identity).unwrap(),
            },
        };
        (program, records)
    }

    pub fn advance_transaction(
        &self,
        program: &AdvanceRoom,
        records: &InputRecords,
    ) -> ProgramTransaction {
        let address = self.writer.shielded_address().unwrap();
        records
            .create_program_transaction(
                program,
                checked(|| program.execute()).unwrap(),
                &address,
                address.solana_address().unwrap(),
            )
            .unwrap()
    }
}
