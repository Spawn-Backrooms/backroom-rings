package transfer

import (
	"errors"

	"github.com/consensys/gnark/frontend"
	"github.com/helius-labs/zolana-custom-rings/prover/circuits/shared"
	"github.com/helius-labs/zolana/prover/server/circuits/gadget"
	transaction "github.com/helius-labs/zolana/prover/server/circuits/spp_transaction/shared"
)

// SpawnRoomAdvanceCircuit is a separate experimental key family. It must never
// be accepted as a room application proof without the state and grant relation.
// The original transfer key family is unchanged.
type SpawnRoomAdvanceCircuit struct {
	TransferCircuit
}

func NewSpawnRoomAdvanceCircuit(shape Shape) (*SpawnRoomAdvanceCircuit, error) {
	if shape.Entry {
		return nil, errors.New("room advances cannot spend default-ring notes")
	}
	base, err := NewTransferCircuit(shape)
	if err != nil {
		return nil, err
	}
	return &SpawnRoomAdvanceCircuit{TransferCircuit: *base}, nil
}

func (c *SpawnRoomAdvanceCircuit) Define(api frontend.API) error {
	if c.Shape.Entry {
		return errors.New("room advances cannot use entry keys")
	}
	if err := c.TransferCircuit.Define(api); err != nil {
		return err
	}
	api.AssertIsEqual(c.Hidden, 1)
	api.AssertIsEqual(c.InProof, 0)
	api.AssertIsEqual(c.Delegate, 0)
	api.AssertIsEqual(c.SignerCount, 0)
	api.AssertIsEqual(c.Shape.Stream().AssertLayout(api, c.Layout), 0)
	api.AssertIsEqual(api.IsZero(c.PolicyHash), 0)
	api.AssertIsEqual(api.IsZero(c.TrackingRoot), 0)
	api.AssertIsEqual(c.WithdrawalCount, 0)
	for i := range c.PublicAmounts {
		api.AssertIsEqual(c.PublicAmounts[i], 0)
		api.AssertIsEqual(c.PublicGross[i], 0)
	}
	// The base proof already binds these exact wires to the ordered SPP
	// transaction. Reopening them here cannot introduce a second witness.
	for _, input := range c.Inputs[1:] {
		api.AssertIsEqual(input.Domain, transaction.DummyDomain)
	}
	for _, output := range c.Outputs[1:] {
		api.AssertIsEqual(output.Output.Domain, transaction.DummyDomain)
	}
	emptyAddresses := make([]frontend.Variable, len(c.Inputs))
	for i := range emptyAddresses {
		emptyAddresses[i] = 0
	}
	api.AssertIsEqual(c.AddressChain, gadget.NonZeroHashChain(api, emptyAddresses))
	assertSpawnRoomNotePair(api, c.RingProgramID, c.Inputs[0].OpenSlot(api), c.Outputs[0].Output.OpenSlot(api))
	return nil
}

// This relation deliberately does not choose a state codec, grant verifier,
// or public-input encoding. It is only the nonfinancial note-shape boundary.
func assertSpawnRoomNotePair(api frontend.API, ringID frontend.Variable, old, next shared.Output) {
	api.AssertIsEqual(api.IsZero(ringID), 0)
	for _, note := range []shared.Output{old, next} {
		api.AssertIsEqual(note.Utxo, 1)
		api.AssertIsEqual(note.Ring, 1)
		api.AssertIsEqual(note.Exit, 0)
		api.AssertIsEqual(note.RingProgramID, ringID)
		api.AssertIsEqual(note.Amount, 0)
		api.AssertIsEqual(api.IsZero(note.OwnerPkHash), 0)
		api.AssertIsEqual(api.IsZero(note.NullifierPk), 0)
		api.AssertIsEqual(api.IsZero(api.Sub(note.NullifierPk, shared.ZeroNullifierPk)), 0)
	}
	api.AssertIsEqual(old.OwnerPkHash, next.OwnerPkHash)
	api.AssertIsEqual(old.NullifierPk, next.NullifierPk)
	api.AssertIsEqual(old.Asset, next.Asset)
	api.AssertIsEqual(api.IsZero(api.Sub(old.Hash, next.Hash)), 0)
}
