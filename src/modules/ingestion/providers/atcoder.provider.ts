import * as cheerio from 'cheerio';
import { IContestProvider, NormalizedContest } from '../interfaces/contest-provider.interface';
import { logger } from '../../../shared/logger';

export class AtCoderProvider implements IContestProvider {
  public readonly platform = 'ATCODER' as const;
  private readonly contestsUrl = 'https://atcoder.jp/contests/';

  public async fetchUpcomingContests(): Promise<NormalizedContest[]> {
    const response = await fetch(this.contestsUrl, {
      headers: {
        'User-Agent': 'PulseCP-Engine/1.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`AtCoder HTTP error: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const upcoming: NormalizedContest[] = [];
    const now = Date.now();

    $('#contest-table-upcoming tbody tr').each((_, row) => {
      const columns = $(row).find('td');
      if (columns.length < 3) return;

      // Column 0: Start Time (e.g., "2026-10-31 21:00:00+0900")
      const rawTimeText = $(columns[0]).find('time').text().trim();
      const startTime = new Date(rawTimeText);
      if (isNaN(startTime.getTime()) || startTime.getTime() <= now) return;

      // Column 1: Contest Link & Title
      const titleAnchor = $(columns[1]).find('a').last();
      const name = titleAnchor.text().trim();
      const relativeHref = titleAnchor.attr('href'); // e.g., "/contests/abc380"
      if (!name || !relativeHref) return;

      const externalId = relativeHref.split('/').filter(Boolean).pop();
      if (!externalId) return;

      // Column 2: Duration (e.g., "01:40" -> HH:MM)
      const durationText = $(columns[2]).text().trim();
      const [hoursStr = '0', minutesStr = '0'] = durationText.split(':');
      const durationSeconds =
        parseInt(hoursStr, 10) * 3600 + parseInt(minutesStr, 10) * 60;

      upcoming.push({
        platform: this.platform,
        externalId,
        name,
        url: `https://atcoder.jp${relativeHref}`,
        startTime,
        durationSeconds: isNaN(durationSeconds) ? 6000 : durationSeconds,
      });
    });

    logger.debug({ count: upcoming.length }, 'Fetched upcoming AtCoder contests');
    return upcoming;
  }
}