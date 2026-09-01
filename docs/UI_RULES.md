# UI and responsive rules

Updated: 2026-08-24

## Design direction

The site should feel modern, restrained, and editorial rather than flashy. It is a research archive first.

Light mode uses a soft cream/off-white background rather than pure white to reduce eye fatigue and visually harmonize with many report backgrounds. Dark mode is supported. Do not copy report background colors exactly; the site shell should remain visually distinct.

Avoid decorative complexity that competes with the reports themselves. The page should not look empty, but visual hierarchy should come from spacing, typography, borders, subtle surfaces, and state changes rather than strong gradients or excessive animation.

## Responsive policy

Mobile First is the priority because many readers will arrive from phones, but every UI change must be checked on desktop as well.

Baseline checks:

- mobile: approximately 360–430px wide Android Chrome
- desktop: 1280px or wider browser
- no horizontal page scrolling unless a deliberately scrollable control requires it
- fixed/sticky UI must not cover report content
- tap targets must remain usable on touch screens
- desktop-only interactions such as hover must degrade safely on mobile
- links and interactive report elements should show an appropriate pointer cursor on desktop

If a change is made specifically to mobile, test desktop before marking it complete. If a change is made specifically to desktop, test mobile before marking it complete.

## Navigation

Language navigation:

- Korean remains the first-visit default at `/`; English uses `/en/` without browser-language redirects. After an explicit English choice, only a later `/` visit may restore `/en/` (preserving `?category=`); explicit About and report URLs never redirect from saved preference.
- desktop uses a restrained text `KO | EN` control beside the theme toggle;
- mobile puts a `Language` section at the bottom of the hamburger menu instead of adding another header button;
- no flag icons;
- explicit homepage language switches preserve the current `?category=` value, and About switches between `/about/` and `/en/about/`;
- the active locale is clear but visually secondary to report navigation.

Homepage public categories:

- 데일리
- 위클리
- 리서치
- 시장 공부
- 끄적끄적
- 소개

Internal category values are `daily`, `weekly`, `research`, `basics`, `note`. Market Basics is a core category; Notes remains a secondary category without being renamed or removed. `소개` links to `/about/` and is a secondary site page rather than a report category.

Report pages use a fixed shared top bar:

`← 홈 | 데일리 | 위클리 | 리서치 | 시장 공부 | 끄적끄적 | 소개`

The current category should have a clear but restrained active state. The report navigation is injected outside the original report design and must remain visually stable regardless of report-specific CSS.

English report pages use the same isolated top bar with English category and comment copy. Their KO/EN switch should prefer a matching `translationGroup` report and fall back to the selected locale homepage when no counterpart exists.

## Snowshagal homepage hero

The homepage opens with the Snowshagal brand rather than a rotating post or a generic research-archive title.

- keep `SNOWSHAGAL` visually primary and treat `MARKET RESEARCH` as a small descriptor;
- preserve the Korean headline `하루의 움직임에서, 다음 흐름까지.` and its requested supporting copy without embellishment;
- use the original watercolor artwork as atmosphere, with ample ivory negative space and restrained chart, paper, moon, and small-town motifs;
- avoid photorealistic winter/travel imagery and avoid decorative red/blue finance colors outside actual data;
- on desktop, keep the copy readable on the left and let the illustration breathe across the right side;
- at 320–480px, show the headline and supporting copy first, then continue the artwork below as a deliberate mobile composition rather than a scaled desktop spread;
- keep Daily / Weekly / Research as concise hero entry points and retain Market Basics / Notes in the main navigation and archive;
- the latest report cards must continue to render from localized post data and may use the existing optional `coverImage` or a restrained CSS fallback;
- respect `prefers-reduced-motion` and keep hover movement subtle.

## Homepage archive

- on desktop, use a restrained two-column editorial layout: the recent-report list takes the flexible main column and a 270–300px category index sits alongside it;
- calculate category counts from the loaded post data, including explicit zero counts, and reuse the existing `?category=` navigation;
- keep report rows compact and omit empty subtitle markup so missing subtitles do not create artificial space;
- at tablet and mobile widths, stack the recent reports first and the archive index second without horizontal overflow;
- keep the index typographic and border-led rather than turning it into a dashboard or adding popularity metrics.

## Admin category selection

- the new-report page must show all five report categories at once using native radio semantics;
- automatic type detection is an initial selection, not a lock: always allow a manual override and show whether the current state came from detection or direct selection;
- an unclassified report remains unselected and cannot be published until the administrator chooses a category;
- the submitted type values remain `daily`, `weekly`, `research`, `basics`, and `note`.

## Admin cover generation

- `/admin/` may generate a 900×1350 cover once from the locally uploaded report HTML before publishing; the public homepage never generates covers at runtime;
- prefer `meta[name="report-cover-selector"]`, then conservative cover/first-page candidates, and use the restrained editorial template when capture is unavailable or ambiguous;
- generated covers must immediately reuse the PC 1280, mobile 430, and mobile 360 crop previews and the same publish payload as manual JPG/PNG/WebP covers;
- automatic generation remains optional, failures must not block publishing, and manual cover upload must remain available.

## Admin announcements

- `/admin/market/announcements/` follows the existing dense, border-led Admin language rather than introducing a separate dashboard design;
- title/content are plain text fields and public rendering must escape them before preserving line breaks;
- datetime-local values are labeled KST and converted to UTC explicitly instead of inheriting the operator browser timezone;
- the list must keep type, audience, derived status, exposure window, timestamps, edit, and delete visible on desktop, then reflow to labeled rows on mobile without page-level horizontal overflow;
- Draft/Scheduled/Published/Expired are operational states, not decorative badges; use restrained emphasis and avoid status-chip proliferation.

## Report isolation

Uploaded reports are standalone documents and can contain global CSS rules. Do not assume their CSS is well-scoped.

Shared report UI should therefore be isolated from original report styles. The current implementation uses Shadow DOM in `assets/report-shell.js` for the top navigation and comments.

Do not replace the current model by directly merging report markup into the homepage DOM unless there is a strong architectural reason and regression testing is available.

## Comments UI

Desktop:

- comment section appears after the report
- composer may be visible immediately
- layout can use two columns for nickname/password where appropriate

Mobile:

- do not show a large composer immediately on entry to the comment section
- show comment heading/count and a `댓글 쓰기` control first
- expand the composer only when requested
- comment list remains visible without requiring composer expansion
- after successful submission, composer may collapse again

The comments UI should look like part of the site shell, not like part of the uploaded report design.

## Theme behavior

The homepage supports light/dark theme state. New site-level surfaces should consider both modes where practical.

Report contents themselves are not forcibly recolored by the site. Their original visual design should remain intact. Shared report navigation and comments can use a consistent site-controlled surface.

## Things not to add without explicit request

- view counts
- popular-post rankings
- badges or gamification
- auto-playing decorative animation
- large marketing hero graphics
- intrusive modals
- account/login UI

Leave room for future expansion, but do not pre-build unused UI that makes the current product heavier.
