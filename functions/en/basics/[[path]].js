import { onGlossaryRequest } from '../../_glossary.js';

// /en/basics/glossary/; /en/basics/ itself and everything else under it is
// served by the static site.
export const onRequestGet = (context) => onGlossaryRequest(context);
export const onRequestHead = onRequestGet;
