# Hey Sammy Free Line Dancing Access

**Product brief:** Hire Line Dancers partner experience
**Status:** Proposed
**Date:** August 4, 2026
**Owners:** Hire Line Dancers and Hey Sammy

## Decision

Hire Line Dancers should give ordinary dancers free access to Hey Sammy's verified line-dancing venue and activity inventory. A visitor should enter a ZIP code on Hire Line Dancers, follow a partner link, and immediately see relevant line-dancing results. The experience should not require onboarding, an account, a trial, or a paid Hey Sammy subscription.

The free entitlement is limited to line dancing. Hey Sammy can invite the visitor to create an account or subscribe when the visitor asks for other activity categories, personalization, alerts, saved plans, or broader product features.

This creates a clean exchange:

- Hire Line Dancers gives dancers a genuinely useful free service without building a national venue database.
- Hey Sammy receives qualified traffic and introduces its broader product through a high-intent use case.
- Both brands help more people find recurring places to dance.

## Current state

The concept is feasible, but the current Hey Sammy web app does not provide the proposed experience yet.

- `Line dancing` is already a canonical activity category.
- The existing Explore page accepts an exact city and category filter.
- An existing preview user can currently reach a route such as `/explore?city=San%20Francisco&category=Line%20dancing` without completing onboarding.
- The entire web app is currently protected by a shared preview password.
- There is no implemented production subscription paywall in this repository.
- User-facing ZIP search and distance ranking are not implemented.
- Venue records already support ZIP codes, latitude, longitude, and geographic data, which provides a useful foundation.

Relevant implementation references:

- Hey Sammy access gate: `/Users/cjwheelock/hey-sammy-landing/app.tryheysammy.com/proxy.ts`
- Hey Sammy Explore route: `/Users/cjwheelock/hey-sammy-landing/app.tryheysammy.com/app/explore/page.tsx`
- Line-dancing category: `/Users/cjwheelock/hey-sammy-landing/app.tryheysammy.com/lib/categories.ts`
- Venue and location types: `/Users/cjwheelock/hey-sammy-landing/app.tryheysammy.com/lib/types.ts`
- Inventory query helpers: `/Users/cjwheelock/hey-sammy-landing/app.tryheysammy.com/lib/data.ts`

The native iOS app is outside the available repository, so its paywall, universal-link, and entitlement behavior still requires a separate audit.

## Visitor promise

> Find verified places to line dance near your ZIP code, free through Hire Line Dancers and Hey Sammy.

The first version should answer one question well: "Where can I line dance near me?"

It should not ask the visitor to build a profile before answering that question.

## Recommended deep-link contract

Use a public route whose path defines the free product. Do not rely on a client-controlled query parameter such as `bypass_paywall=true`.

```text
https://app.tryheysammy.com/free/activities/line-dancing
  ?postal_code=94110
  &country=US
  &radius_miles=25
  &partner=hire-line-dancers
  &utm_source=hirelinedancers
  &utm_medium=partner_referral
  &utm_campaign=line_dance_finder
  &utm_content=homepage
  &placement_id=homepage_finder
```

### Parameters

| Parameter | Requirement | Purpose |
| --- | --- | --- |
| `postal_code` | Required for first release | Valid US ZIP or ZIP+4 submitted by the visitor |
| `country` | Optional, defaults to `US` | Allows later Canadian or other market support |
| `radius_miles` | Optional, defaults to `25` | Allowlist values such as 5, 10, 25, and 50 |
| `partner` | Required | Stable value `hire-line-dancers` |
| `placement_id` | Required | Identifies the exact HLD placement or campaign |
| UTM parameters | Recommended | Standard acquisition reporting |
| `price` | Optional future filter | `any` or `free`, if no-cost events become a separate user request |

The word "free" in the product promise means free access to the venue finder. It does not mean every listed activity must have a zero-dollar admission price.

## Visitor flow

1. A visitor selects "Find places to line dance" on Hire Line Dancers.
2. The visitor enters a ZIP code and optionally selects a radius.
3. Hire Line Dancers opens the Hey Sammy partner route with attribution attached.
4. Hey Sammy validates the ZIP and returns approved line-dancing results ranked by distance and usefulness.
5. The visitor can open details, follow the venue's participation link, or add an eligible activity to a calendar without creating an account.
6. Hey Sammy may offer broader recommendations, saved plans, alerts, or other activity categories through a clear optional call to action.
7. A no-results state invites the visitor to expand the radius, request line dancing in the area, or explore how to start a local class through Hire Line Dancers.

## Access and privacy model

- Explicitly allowlist the public partner route and its public detail, calendar, and analytics dependencies.
- Scope anonymous access to approved `line-dancing` records only.
- Never expose candidate, rejected, stale, or internal-review inventory.
- Keep public detail pages within the free route namespace, or display details inline.
- Retain the exact ZIP server-side for search. Send only a market or coarse postal region to third-party analytics.
- Store original partner attribution in a first-party session so it survives navigation.
- Do not silently grant broader paid access through a URL parameter.

## Result requirements

Every public result should have:

- Explicit evidence that it offers line dancing
- A verified venue or location
- A current participation or schedule source
- A clear primary action
- A freshness indicator or internal freshness threshold
- A truthful distance from the submitted ZIP when location data is available

The route must not substitute fictional or unrelated fallback activities when a ZIP has no qualifying inventory. A truthful empty state is part of the product.

## Cross-brand experience

Recommended header treatment:

> Free line-dancing places near you
> Venue information by Hey Sammy, offered free through Hire Line Dancers.

Recommended calls to action:

- Primary: `See schedule` or `Visit venue site`
- Secondary: `Find an instructor for a private event`
- Hey Sammy expansion: `Want more ways to get out and meet people? Explore Hey Sammy.`
- Empty state: `Bring line dancing to my town` and `Learn how to lead a beginner class`

This should feel like a useful partnership, not an affiliate redirect.

## Analytics

Track at minimum:

- `partner_experience_view`
- `postal_search_submitted`
- `activity_results_viewed`
- `activity_opened`
- `registration_or_source_clicked`
- `calendar_added`
- `hld_cta_clicked`
- `hey_sammy_expansion_cta_clicked`
- Downstream `signup_started`, `trial_started`, and `purchase`, where applicable

Useful properties include partner, placement, campaign, category, market, coarse postal region, radius, result count, rank, distance, activity ID, freshness, and session ID.

Partnership reporting should answer:

- How many HLD visitors searched?
- What percentage received at least one result?
- What percentage opened a venue or schedule?
- Which ZIP regions have unmet demand?
- How many visitors later explored broader Hey Sammy features?
- How many no-result visitors requested a class or instructor through HLD?

## Acceptance criteria

The first release is complete when:

1. A new visitor can enter a supported ZIP on HLD and see approved line-dancing results without login, onboarding, trial, or payment.
2. Results are ranked using ZIP or geographic distance, not only city text.
3. Partner attribution survives result and detail navigation.
4. The route exposes only approved line-dancing inventory.
5. Empty and unsupported ZIP states are truthful and actionable.
6. Moving into another activity category triggers the normal Hey Sammy access model.
7. Mobile web links work as the fallback for a future native universal link.
8. HLD and Hey Sammy can separately measure search use, venue engagement, cross-sell, and unmet demand.

## Implementation sequence

1. Agree on the public route and entitlement contract.
2. Add ZIP validation and ZIP-to-coordinate resolution.
3. Add a database query for approved line-dancing inventory within a radius.
4. Create a public partner shell and public detail behavior.
5. Allowlist only the required public routes and APIs.
6. Add attribution persistence and analytics.
7. Add the HLD ZIP form and placement-specific links.
8. Test supported, empty, invalid, and sparse ZIP cases.
9. Audit the native app and add universal-link handling later.

## Decisions still needed

- Which domain owns the canonical link: `app.tryheysammy.com` or a future production app domain?
- Does the free experience include only venues, or also dated public events and classes?
- What inventory freshness threshold is required for public display?
- Should Hey Sammy offer account-free calendar actions?
- How will HLD and Hey Sammy share aggregate partnership reporting?
- Which brand handles support requests and venue corrections?
- Will the native app recognize the link at launch, or will mobile web be the initial experience?
