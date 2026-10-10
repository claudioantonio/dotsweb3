import type { Address, MatchEndedNotice, ReasonCode, RejectedReport } from "@dotsweb3/protocol";

export interface RejectionCopy {
  title: string;
  description: string;
  /** Extra navigation the UI should offer. */
  link?: "liveMatch" | "lobby";
}

/** ux-plan §4: every rejection names the cause and the fix; never blame the player for infra. */
const COPY: Record<ReasonCode, RejectionCopy> = {
  MALFORMED_PAYLOAD: { title: "Input not understood", description: "The machine couldn't read that input. Reload the page and try again." },
  UNKNOWN_ACTION: { title: "Unknown action", description: "This app version sent an action the machine doesn't know. Reload the page." },
  NOT_OWNER: { title: "Owner only", description: "Only the session owner can schedule sessions." },
  INVALID_SESSION: { title: "Invalid session", description: "The session times or settings were rejected by the machine." },
  NO_OPEN_SESSION: { title: "No open session", description: "There's no session open for joining right now — check the lobby countdown.", link: "lobby" },
  PAST_CUTOFF: { title: "Match starts are closed", description: "Pairing has closed for this session. Live matches still play to the end.", link: "lobby" },
  ALREADY_QUEUED: { title: "Already in the queue", description: "You're already waiting for an opponent." },
  IN_LIVE_MATCH: { title: "You still have a live match", description: "Finish it or claim a forfeit before joining again.", link: "liveMatch" },
  NOT_QUEUED: { title: "Not in the queue", description: "You weren't in the queue — nothing to leave." },
  NO_SUCH_MATCH: { title: "No such match", description: "That match doesn't exist on the machine." },
  MATCH_ENDED: { title: "Match already over", description: "That match had already ended when your input arrived." },
  NOT_A_PLAYER: { title: "Not your match", description: "Only the two players can act in this match." },
  NOT_YOUR_TURN: { title: "Not your turn", description: "Wait for your opponent's move to confirm, then play." },
  OUT_OF_BOUNDS: { title: "Off the board", description: "That line is outside the board. Pick two dots on the grid." },
  NOT_ADJACENT: { title: "Dots not adjacent", description: "Lines join two neighbouring dots, horizontally or vertically." },
  EDGE_TAKEN: { title: "Line already drawn", description: "Someone drew that line first. Pick another." },
  NOT_THE_WAITING_PLAYER: { title: "It's your turn", description: "Only the waiting player can claim a forfeit — make your move instead." },
  DEADLINE_NOT_ELAPSED: {
    title: "Deadline not passed yet",
    description: "The machine's clock says the deadline hasn't passed yet — try again in a few seconds.",
  },
  ENGINE_ERROR: { title: "Unexpected machine error", description: "The machine hit an unexpected error and rolled back. Nothing changed — try again." },
};

/** Input status REJECTED (§1.4): the machine faulted and its report is lost — generic copy only. */
export const ENGINE_ERROR_COPY: RejectionCopy = COPY.ENGINE_ERROR;

export const FORFEIT_RACE_COPY: RejectionCopy = {
  title: "Your move arrived after the forfeit claim",
  description: "Your move confirmed, but it arrived after your opponent's forfeit claim. The match ended by forfeit.",
};

export function rejectionCopy(report: RejectedReport | null): RejectionCopy {
  if (!report) return ENGINE_ERROR_COPY;
  return COPY[report.code] ?? { title: "Input rejected", description: report.message };
}

/**
 * F12 forfeit race: my `move` was declined MATCH_ENDED for this match, and
 * the match ended by forfeit with me as the loser. A report carrying a
 * different `matchId` never counts; one without `matchId` is trusted to be
 * about this match (caller attributed it).
 */
export function isForfeitRace(report: RejectedReport | null, ended: MatchEndedNotice | null, me: Address): boolean {
  return (
    !!report &&
    !!ended &&
    report.action === "move" &&
    report.code === "MATCH_ENDED" &&
    (report.matchId === undefined || report.matchId === ended.matchId) &&
    ended.forfeit &&
    ended.loser?.toLowerCase() === me.toLowerCase()
  );
}

export type ResultVariant =
  | "WON"
  | "LOST"
  | "WON_BY_FORFEIT"
  | "LOST_BY_FORFEIT"
  | "LOST_FORFEIT_RACE"
  | "ABANDONED"
  | "SPECTATOR";

export function resultVariant(ended: MatchEndedNotice, me: Address | null, forfeitRace: boolean): ResultVariant {
  if (ended.abandoned) return "ABANDONED";
  const self = me?.toLowerCase();
  if (!self || !ended.players.some((p) => p.toLowerCase() === self)) return "SPECTATOR";
  const won = ended.winner?.toLowerCase() === self;
  if (!ended.forfeit) return won ? "WON" : "LOST";
  if (won) return "WON_BY_FORFEIT";
  return forfeitRace ? "LOST_FORFEIT_RACE" : "LOST_BY_FORFEIT";
}

export function resultHeadline(v: ResultVariant, mine: number, theirs: number): { title: string; detail?: string } {
  switch (v) {
    case "WON":
      return { title: `You won ${mine}–${theirs}` };
    case "LOST":
      return { title: `You lost ${mine}–${theirs}` };
    case "WON_BY_FORFEIT":
      return { title: "Won by forfeit", detail: "Your opponent stopped moving." };
    case "LOST_BY_FORFEIT":
      return { title: "Lost by forfeit", detail: "You didn't move in time." };
    case "LOST_FORFEIT_RACE":
      return { title: "Lost — your move arrived after the forfeit claim", detail: FORFEIT_RACE_COPY.description };
    case "ABANDONED":
      return { title: "Abandoned — no winner", detail: "The match sat idle until the next session swept it." };
    case "SPECTATOR":
      return { title: "Match over" };
  }
}
