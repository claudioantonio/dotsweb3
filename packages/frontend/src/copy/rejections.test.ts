import { REASON_CODES, type RejectedReport } from "@dotsweb3/protocol";
import { describe, expect, it } from "vitest";
import { A, B, C, ended, forfeitEnded, rejectedMatchEnded } from "../state/__fixtures__";
import { ENGINE_ERROR_COPY, FORFEIT_RACE_COPY, isForfeitRace, rejectionCopy, resultHeadline, resultVariant } from "./rejections";

const report = (code: RejectedReport["code"], action: RejectedReport["action"] = "move"): RejectedReport => ({
  type: "Rejected",
  action,
  code,
  message: "m",
});

describe("rejection copy", () => {
  it("has user copy for every protocol reason code", () => {
    for (const code of REASON_CODES) {
      const c = rejectionCopy(report(code));
      expect(c.title, code).not.toBe("Input rejected");
      expect(c.description.length, code).toBeGreaterThan(10);
    }
  });
  it("links IN_LIVE_MATCH to the live match", () => {
    expect(rejectionCopy(report("IN_LIVE_MATCH", "joinQueue")).link).toBe("liveMatch");
  });
  it("uses the machine's clock wording for DEADLINE_NOT_ELAPSED", () => {
    expect(rejectionCopy(report("DEADLINE_NOT_ELAPSED", "claimForfeit")).description).toMatch(/machine's clock/);
  });
  it("a missing report (REJECTED input → engine error) gets the generic engine-error copy", () => {
    expect(rejectionCopy(null)).toBe(ENGINE_ERROR_COPY);
    expect(ENGINE_ERROR_COPY.description).toMatch(/Nothing changed/);
  });
});

describe("forfeit race (F12)", () => {
  it("move rejected MATCH_ENDED + forfeit with me as loser", () => {
    expect(isForfeitRace(rejectedMatchEnded, forfeitEnded, B)).toBe(true);
    expect(isForfeitRace(rejectedMatchEnded, forfeitEnded, A)).toBe(false); // I won
    expect(isForfeitRace(rejectedMatchEnded, ended, A)).toBe(false); // not a forfeit
    expect(isForfeitRace(report("MATCH_ENDED", "claimForfeit"), forfeitEnded, B)).toBe(false);
    expect(isForfeitRace(null, forfeitEnded, B)).toBe(false);
  });
  it("uses matchId when present; trusts the caller when absent", () => {
    expect(isForfeitRace({ ...rejectedMatchEnded, matchId: "2" }, forfeitEnded, B)).toBe(false);
    const { matchId: _omit, ...noMatchId } = rejectedMatchEnded;
    expect(isForfeitRace(noMatchId, forfeitEnded, B)).toBe(true);
  });
  it("result variants", () => {
    expect(resultVariant(ended, B, false)).toBe("WON");
    expect(resultVariant(ended, A, false)).toBe("LOST");
    expect(resultVariant(forfeitEnded, A, false)).toBe("WON_BY_FORFEIT");
    expect(resultVariant(forfeitEnded, B, false)).toBe("LOST_BY_FORFEIT");
    expect(resultVariant(forfeitEnded, B, true)).toBe("LOST_FORFEIT_RACE");
    expect(resultVariant({ ...ended, abandoned: true, winner: null, loser: null }, A, false)).toBe("ABANDONED");
    expect(resultVariant(ended, C, false)).toBe("SPECTATOR");
    expect(resultHeadline("LOST_FORFEIT_RACE", 0, 0).detail).toBe(FORFEIT_RACE_COPY.description);
    expect(resultHeadline("WON", 13, 12).title).toBe("You won 13–12");
  });
});
