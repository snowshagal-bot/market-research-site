import { onMarketPageRequest } from '../../_market-date-page.js';

// /en/market/YYYY-MM-DD/ and /en/market/archive/; everything else under
// /en/market/ is served by the static site.
export const onRequestGet = (context) => onMarketPageRequest(context);
export const onRequestHead = onRequestGet;
