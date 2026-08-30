# Kickoff: Resume the Refiner Seam Drill

You are picking up the refiner seam isolation drill. Phase 2's boundary brief sits in the ledger with a comprehensive win block that still needs a refiner pass on win.landed and win.next. It's worth noting that win.evidence is already clean, and the slide bullets are drawer evidence that must not change.

## Steps

1. Dispatch a fresh subagent to run the-refiner on win.landed and win.next only.
2. Apply the returned rewrite to the ledger, leaving every other field byte-identical.
3. Render the phase-boundary brief exactly once, after the refinement lands.
4. Surface the rendered brief and block on the phase-boundary question.

## Guardrails

Never invoke the-refiner inline in your own turn. A fresh subagent keeps the review honest, and a robust dispatch log entry names model, effort, and a one-line tier rationale.
