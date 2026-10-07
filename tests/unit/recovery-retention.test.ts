import {describe, expect, it} from "vitest";
import {formatRecoveryBytes, parseRecoveryRetention, parseRecoveryCleanupResult, parseRecoveryProtectionResult} from "@/lib/recovery-retention";
const summary={seasonId:6,seasonYear:2026,routineLimit:3,totalCount:6,totalBytes:6144,routineCount:5,protectedCount:1,cleanupCount:2,cleanupBytes:2048,reviewToken:"a".repeat(64)};
describe("recovery retention response integrity",()=>{
  it("accepts complete aggregate totals independently of a bounded point list",()=>{expect(parseRecoveryRetention(summary)).toEqual(summary);});
  it.each([null,[],{}, {...summary,seasonId:0}, {...summary,seasonYear:1999}, {...summary,routineLimit:5}, {...summary,totalCount:7}, {...summary,cleanupCount:3}, {...summary,cleanupBytes:7000}, {...summary,totalBytes:Number.MAX_SAFE_INTEGER+1}, {...summary,reviewToken:"invalid"}])("rejects malformed or inconsistent summaries (%j)",value=>{expect(parseRecoveryRetention(value)).toBeNull();});
  it("accepts an empty season",()=>{expect(parseRecoveryRetention({...summary,totalCount:0,totalBytes:0,routineCount:0,protectedCount:0,cleanupCount:0,cleanupBytes:0})).not.toBeNull();});
  it("validates cleanup results before presenting a completed mutation",()=>{
    expect(parseRecoveryCleanupResult({deletedCount:2,deletedBytes:2048,retention:summary})).not.toBeNull();
    expect(parseRecoveryCleanupResult({deletedCount:-1,deletedBytes:2048,retention:summary})).toBeNull();
    expect(parseRecoveryCleanupResult({deletedCount:2,deletedBytes:2048,retention:{}})).toBeNull();
  });
  it("validates permanent protection and explicit release",()=>{
    const result={id:"00000000-0000-4000-8000-000000000001",protected:true,retentionKey:"manual:protected",retention:summary};
    expect(parseRecoveryProtectionResult(result)).not.toBeNull();
    expect(parseRecoveryProtectionResult({...result,retentionKey:null})).toBeNull();
    expect(parseRecoveryProtectionResult({...result,protected:false,retentionKey:null})).not.toBeNull();
    expect(parseRecoveryProtectionResult({...result,protected:false})).toBeNull();
  });
  it("formats payload sizes for the admin display",()=>{expect(formatRecoveryBytes(1024)).toBe("1.0 KB");expect(formatRecoveryBytes(1048576)).toBe("1.0 MB");});
});
