import { onMarketPageRequest } from '../../_market-date-page.js';

// /en/market/YYYY-MM-DD/, /en/market/archive/, /en/market/sectors/, /en/market/investor-flows/ and the
// indicator histories (/en/market/kospi/ …); everything else under
// /en/market/ is served by the static site.
export const onRequestGet = (context) => onMarketPageRequest(context);
export const onRequestHead = onRequestGet;
