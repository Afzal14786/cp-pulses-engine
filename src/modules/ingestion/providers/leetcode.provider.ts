import { IContestProvider, NormalizedContest } from '../interfaces/contest-provider.interface';
import { logger } from '../../../shared/logger';

interface LeetCodeContestRaw {
  title: string;
  titleSlug: string;
  startTime: number; // Unix timestamp in seconds
  duration: number;  // Duration in seconds
}

interface LeetCodeGraphQLResponse {
  data?: {
    topTwoContests?: LeetCodeContestRaw[];
  };
}

export class LeetCodeProvider implements IContestProvider {
  public readonly platform = 'LEETCODE' as const;
  private readonly graphqlUrl = 'https://leetcode.com/graphql';

  public async fetchUpcomingContests(): Promise<NormalizedContest[]> {
    const query = `
      query UpcomingContests {
        topTwoContests {
          title
          titleSlug
          startTime
          duration
        }
      }
    `;

    const response = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
        Referer: 'https://leetcode.com/contest/',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`LeetCode HTTP error: ${response.status}`);
    }

    const payload = (await response.json()) as LeetCodeGraphQLResponse;
    const contestsRaw = payload.data?.topTwoContests ?? [];
    const nowSeconds = Math.floor(Date.now() / 1000);

    const upcoming = contestsRaw
      .filter((c) => c.startTime > nowSeconds)
      .map((c): NormalizedContest => ({
        platform: this.platform,
        externalId: c.titleSlug,
        name: c.title,
        url: `https://leetcode.com/contest/${c.titleSlug}/`,
        startTime: new Date(c.startTime * 1000),
        durationSeconds: c.duration,
      }));

    logger.debug({ count: upcoming.length }, 'Fetched upcoming LeetCode contests');
    return upcoming;
  }
}