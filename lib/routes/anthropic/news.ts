import { load } from 'cheerio';
import pMap from 'p-map';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

export const route: Route = {
    path: '/news',
    categories: ['programming'],
    example: '/anthropic/news',
    parameters: {},
    radar: [
        {
            source: ['www.anthropic.com/news', 'www.anthropic.com'],
        },
    ],
    name: 'News',
    maintainers: ['etShaw-zh', 'goestav'],
    handler,
    url: 'www.anthropic.com/news',
};

async function handler(ctx) {
    const link = 'https://www.anthropic.com/news';
    const response = await ofetch(link);
    const $ = load(response);
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 20;

    const list: DataItem[] = $('ul[class*="PublicationList-module"] a[class*="PublicationList-module"]')
        .toArray()
        .slice(0, limit)
        .map((el) => {
            const $el = $(el);
            const title = $el.find('span[class*="__title"]').text().trim() || $el.find('h2, h4, [class*="featuredTitle"], [class*="__title"]').text().trim();
            const href = $el.attr('href') ?? '';
            const pubDateText = $el.find('time').text().trim();
            const fullLink = href.startsWith('http') ? href : `https://www.anthropic.com${href}`;
            const pubDate = pubDateText ? timezone(parseDate(pubDateText), -8) : undefined;
            const category = $el.find('span[class*="__subject"]').text().trim();

            return {
                title,
                link: fullLink,
                pubDate,
                category,
            };
        });

    const out = await pMap(
        list,
        (item) =>
            cache.tryGet(item.link!, async () => {
                const response = await ofetch(item.link!);
                const $ = load(response);

                const content = $('#main-content');

                content.find('[class*="PostDetail-module"][class*="socialShare"], [class*="subjects"]').remove();
                content.find('header, [class*="header"]').remove();
                content.find('footer, [class*="SiteFooter"], [class*="Recirculation"]').remove();

                content.find('img').each((_, e) => {
                    const $e = $(e);
                    const src = $e.attr('src');
                    if (src && src.includes('/_next/image?url=')) {
                        try {
                            const params = new URLSearchParams(src);
                            const newSrc = params.get('/_next/image?url');
                            if (newSrc) {
                                $e.attr('src', newSrc);
                            }
                        } catch {
                            // URL parsing failed, keep original src
                        }
                    }
                    $e.removeAttr('style srcset');
                });

                item.description = content.html() ?? undefined;

                return item;
            }),
        { concurrency: 5 }
    );

    return {
        title: 'Anthropic News',
        link,
        description: 'Latest news from Anthropic',
        item: out,
    };
}
