# UI and responsive rules

Updated: 2026-08-11

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

Homepage public categories:

- 데일리
- 위클리
- 비정기
- 시장 공부
- 끄적끄적
- 소개

Internal category values are `daily`, `weekly`, `research`, `basics`, `note`. Market Basics is a core category; Notes remains a secondary category without being renamed or removed. `소개` links to `/about/` and is a secondary site page rather than a report category.

Report pages use a fixed shared top bar:

`← 홈 | 데일리 | 위클리 | 비정기 | 시장 공부 | 끄적끄적 | 소개`

The current category should have a clear but restrained active state. The report navigation is injected outside the original report design and must remain visually stable regardless of report-specific CSS.

## Homepage featured carousel

The homepage v2 carousel is an editorial category overview, not a promotional banner or chronological autoplay slider.

- include the latest available post from each core category: daily, weekly, research, Market Basics;
- do not autoplay;
- keep previous/next buttons, category tabs, keyboard state, and current/total status accessible;
- use a separate optional `coverImage` when available;
- use a category/date/title typographic fallback when no cover image exists;
- on mobile, place the cover before the text and preserve vertical scrolling while allowing deliberate horizontal swipe gestures;
- respect `prefers-reduced-motion` and keep transitions subtle.

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
