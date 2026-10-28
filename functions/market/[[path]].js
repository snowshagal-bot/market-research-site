import { onMarketPageRequest } from '../_market-date-page.js';

// /market/YYYY-MM-DD/ and /market/archive/; everything else under /market/
// is served by the static site.
export const onRequestGet = (context) => onMarketPageRequest(context);
export const onRequestHead = onRequestGet;
