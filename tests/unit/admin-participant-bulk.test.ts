import { describe, expect, it } from "vitest";
import { parseParticipantBulkRequest } from "@/lib/admin-participant-bulk";
const A = "abcdefab-0000-4000-8000-000000000001";
const selection = {profile_id:A,expected_is_active:true,expected_status:null};
const form = (values: Record<string,string> = {}) => {
  const data = new FormData();
  for (const [key,value] of Object.entries({operation:"register",participant_season_id:"42",confirm_bulk_update:"yes",participants:JSON.stringify([selection]),...values})) data.set(key,value);
  return data;
};
describe("bounded participant changes", () => {
  it("preserves the explicitly selected season and expected participant values", () => {
    expect(parseParticipantBulkRequest(form())).toEqual({operation:"register",seasonId:42,participants:[selection]});
  });
  it("keeps eligibility independent from selected season registration", () => {
    const parsed = parseParticipantBulkRequest(form({operation:"disable",participants:JSON.stringify([{...selection,expected_status:"registered"}])}));
    expect(parsed.seasonId).toBeNull();
    expect(parsed.participants[0].expected_status).toBeNull();
  });
  it.each(["", "0", "-1", "1.5", "9007199254740992", "unknown"])("rejects invalid season %s", participant_season_id => {
    expect(() => parseParticipantBulkRequest(form({participant_season_id}))).toThrow("Choose an active or upcoming season");
  });
  it("requires explicit confirmation", () => expect(() => parseParticipantBulkRequest(form({confirm_bulk_update:""}))).toThrow("Confirm"));
  it("rejects unknown operations", () => expect(() => parseParticipantBulkRequest(form({operation:"delete"}))).toThrow("Choose"));
  it.each(["[]", "null", "{}", "not JSON", JSON.stringify([null]), JSON.stringify([{...selection,profile_id:"bad"}]), JSON.stringify([{...selection,expected_is_active:"true"}]), JSON.stringify([{...selection,expected_status:"pending"}]), JSON.stringify([{profile_id:A,expected_is_active:true}])])("rejects malformed selections %s", participants => {
    expect(() => parseParticipantBulkRequest(form({participants}))).toThrow();
  });
  it("rejects case-insensitive duplicate IDs", () => {
    expect(() => parseParticipantBulkRequest(form({participants:JSON.stringify([selection,{...selection,profile_id:A.toUpperCase()}])}))).toThrow("only be selected once");
  });
  it("caps batch size at 100", () => {
    const participants = Array.from({length:101},(_,i)=>({...selection,profile_id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`}));
    expect(() => parseParticipantBulkRequest(form({participants:JSON.stringify(participants)}))).toThrow("between 1 and 100");
    expect(parseParticipantBulkRequest(form({participants:JSON.stringify(participants.slice(0,100))})).participants).toHaveLength(100);
  });
  it("bounds payload bytes before parsing", () => expect(() => parseParticipantBulkRequest(form({participants:" ".repeat(25_001)}))).toThrow("between 1 and 100"));
});
