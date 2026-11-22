mod advance_room;
mod create_room;
mod state;
pub use advance_room::{
    AcceptanceGrant, AdvanceRoom, AdvanceRoomPrivateInputs, AdvanceRoomPublicInputs,
};
pub use create_room::{CreateRoom, CreateRoomPrivateInputs, CreateRoomPublicInputs};
pub use state::{AcceptedMemory, LearnedPolicy, RoomBinding, RoomStateV0};

#[cfg(all(not(xark), not(xark_client)))]
pub use advance_room::{
    AcceptanceGrantClient, AdvanceRoomClient, AdvanceRoomPrivateInputsClient,
    AdvanceRoomPublicInputsClient,
};
#[cfg(all(not(xark), not(xark_client)))]
pub use create_room::{
    CreateRoomClient, CreateRoomPrivateInputsClient, CreateRoomPublicInputsClient,
};
#[cfg(all(not(xark), not(xark_client)))]
pub use state::{AcceptedMemoryClient, LearnedPolicyClient, RoomBindingClient, RoomStateV0Client};

#[cfg(all(not(xark), not(xark_client)))]
pub fn room_authority(writer: &pinocchio::Address) -> spr_program::ProgramOwner {
    spr_program::ProgramOwner::find(&crate::room_authority_seeds(writer), &crate::ID)
}
