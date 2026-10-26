import { IContestProvider, NormalizedContest } from '../interfaces/contest-provider.interface';
import { logger } from '../../../shared/logger';

interface CodeforcesContestRaw {
  id: number;
  name: string;
  type: string;
  phase: 'BEFORE' | 'CODING' | 'PENDING_SYSTEM_TEST' | 'SYSTEM_TEST' | 'FINISHED';
  frozen: boolean;
  durationSeconds: number;
  startTimeSeconds?: number;
}

interface CodeforcesApiResponse {
  status: 'OK' | 'FAILED';
  result?: CodeforcesContestRaw[];
  comment?: string;
}

export class CodeforcesProvider implements IContestProvider {
  public readonly platform = 'CODEFORCES' as const;
  private readonly apiUrl = 'https://codeforces.com/api/contest.list?gym=false';

  public async fetchUpcomingContests(): Promise<NormalizedContest[]> {
    const response = await fetch(this.apiUrl, {
      headers: { 'User-Agent': 'PulseCP-Engine/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Codeforces HTTP error: ${response.status}`);
    }

    const data = (await response.json()) as CodeforcesApiResponse;

    if (data.status !== 'OK' || !data.result) {
      throw new Error(`Codeforces API error: ${data.comment ?? 'Unknown failure'}`);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    const upcoming = data.result
      .filter(
        (c): c is CodeforcesContestRaw & { startTimeSeconds: number } =>
          c.phase === 'BEFORE' &&
          typeof c.startTimeSeconds === 'number' &&
          c.startTimeSeconds > nowSeconds
      )
      .map((c): NormalizedContest => ({
        platform: this.platform,
        externalId: String(c.id),
        name: c.name,
        url: `https://codeforces.com/contests/${c.id}`,
        startTime: new Date(c.startTimeSeconds * 1000),
        durationSeconds: c.durationSeconds,
      }));

    logger.debug({ count: upcoming.length }, 'Fetched upcoming Codeforces contests');
    return upcoming;
  }
}