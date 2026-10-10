// @vitest-environment jsdom
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { rebuild } from "../engine-adapter";
import { A, B, C, liveView } from "../state/__fixtures__";
import { CLAIM_SLACK_SECONDS, fromMatchView } from "../state/match";
import { system } from "../theme";
import { MatchPanel } from "./MatchPanel";

const match = fromMatchView(liveView); // A on turn
const D = liveView.forfeitDeadline!;
const board = rebuild(match.gridSize, match.players, match.matchId, match.moves).board;

function renderPanel(over: Partial<ComponentProps<typeof MatchPanel>>) {
  const props: ComponentProps<typeof MatchPanel> = {
    match,
    board,
    divergence: null,
    me: A,
    now: D - 47,
    phase: "OPEN",
    pending: null,
    txLabel: null,
    busy: false,
    claimPending: false,
    onEdge: () => {},
    onClaim: () => {},
    ...over,
  };
  return render(
    <ChakraProvider value={system}>
      <MatchPanel {...props} />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("MatchPanel", () => {
  it("my turn shows my countdown", () => {
    renderPanel({});
    expect(screen.getByText(/Your move/)).toBeTruthy();
    expect(screen.getAllByText("0:47").length).toBeGreaterThan(0);
    expect(screen.queryByText("Claim forfeit")).toBeNull();
  });

  it("their turn with a pending edge badge", () => {
    renderPanel({
      me: B,
      pending: { matchId: "1", moveIndex: 2, edge: [[1, 0], [1, 1]], submitter: B },
      txLabel: "Move #3 · Waiting for the machine…",
      busy: true,
    });
    expect(screen.getByText(/Waiting for 0xaaaa/)).toBeTruthy();
    expect(screen.getByTestId("pending-edge")).toBeTruthy();
    expect(screen.getByText(/Waiting for the machine/)).toBeTruthy();
  });

  it("opponent timed out → Claim forfeit (only after slack)", () => {
    renderPanel({ me: B, now: D + CLAIM_SLACK_SECONDS });
    expect(screen.queryByText("Claim forfeit")).toBeNull();
    cleanup();
    renderPanel({ me: B, now: D + CLAIM_SLACK_SECONDS + 1 });
    expect(screen.getByRole("button", { name: "Claim forfeit" })).toBeTruthy();
  });

  it("I timed out → amber warning, can still move", () => {
    renderPanel({ now: D + 1 });
    expect(screen.getByText("Your turn has expired")).toBeTruthy();
  });

  it("spectator sees a read-only live view", () => {
    renderPanel({ me: C, onEdge: undefined, onClaim: undefined });
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText(/Leaving the page/)).toBeNull();
  });
});
