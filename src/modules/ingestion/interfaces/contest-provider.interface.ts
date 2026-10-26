export type PlatformType = 'LEETCODE' | 'CODEFORCES' | 'CODECHEF' | 'ATCODER';

export interface NormalizedContest {
  platform: PlatformType;
  externalId: string;
  name: string;
  url: string;
  startTime: Date;        // Always normalized to UTC Date object
  durationSeconds: number;
}

export interface IContestProvider {
  readonly platform: PlatformType;
  fetchUpcomingContests(): Promise<NormalizedContest[]>;
}