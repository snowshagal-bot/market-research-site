import { onMarketPageRequest } from '../_market-date-page.js';

// /market/YYYY-MM-DD/, /market/archive/, /market/sectors/ and the indicator
// histories (/market/kospi/ …); everything else under /market/
// is served by the static site.
export const onRequestGet = (context) => onMarketPageRequest(context);
export const onRequestHead = onRequestGet;
