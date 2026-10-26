import { IContestProvider, NormalizedContest } from '../interfaces/contest-provider.interface';
import { logger } from '../../../shared/logger';

interface CodeChefContestRaw {
  contest_code: string;
  contest_name: string;
  contest_start_date_iso: string;
  contest_end_date_iso: string;
  contest_duration: string; // Duration in minutes
}

interface CodeChefApiResponse {
  status: string;
  future_contests?: CodeChefContestRaw[];
}

export class CodeChefProvider implements IContestProvider {
  public readonly platform = 'CODECHEF' as const;
  private readonly apiUrl =
    'https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all';

  public async fetchUpcomingContests(): Promise<NormalizedContest[]> {
    const response = await fetch(this.apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) PulseCP-Engine/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`CodeChef HTTP error: ${response.status}`);
    }

    const data = (await response.json()) as CodeChefApiResponse;
    const futureContests = data.future_contests ?? [];
    const now = Date.now();

    const upcoming = futureContests
      .map((c): NormalizedContest | null => {
        const startTime = new Date(c.contest_start_date_iso);
        if (isNaN(startTime.getTime()) || startTime.getTime() <= now) {
          return null;
        }

        const durationMinutes = parseInt(c.contest_duration, 10);
        const durationSeconds = !isNaN(durationMinutes)
          ? durationMinutes * 60
          : Math.max(
              0,
              Math.floor(
                (new Date(c.contest_end_date_iso).getTime() - startTime.getTime()) / 1000
              )
            );

        return {
          platform: this.platform,
          externalId: c.contest_code,
          name: `CodeChef - ${c.contest_name}`,
          url: `https://www.codechef.com/${c.contest_code}`,
          startTime,
          durationSeconds,
        };
      })
      .filter((c): c is NormalizedContest => c !== null);

    logger.debug({ count: upcoming.length }, 'Fetched upcoming CodeChef contests');
    return upcoming;
  }
}