/**
 * Allowlists for POST /api/analytics/event.
 *
 * These live in their own module (rather than inside the route) so a test can
 * import the REAL sets and check a caller's payload against them. The failure
 * mode they guard is silent: the route drops any prop key not listed here and
 * still answers 200, so a field added to a caller without being added here is
 * simply absent when someone queries for it weeks later — no error anywhere
 * (CLAUDE.md: "A silently-dropped field is the default failure").
 */

export const ALLOWED_EVENTS = new Set([
  'cite', 'share', 'quote_copy', 'doi_view', 'download', 'signin_view',
  // signup_start: fired when a visitor initiates sign-up from a surface, so we
  // can attribute signups by `source` (hero / signin_page / …) and `method`.
  'signup_start',
  // confirm_view / confirm_click: the two halves of the magic-link interstitial
  // at /auth/confirm. views-minus-clicks is the drop-off introduced by the
  // prefetch-safe second click; without them an unconsumed verification token
  // is indistinguishable from mail that was never opened at all.
  'confirm_view', 'confirm_click',
  // welcome_view / welcome_save / welcome_skip: the onboarding form at /welcome.
  // It shipped with no instrumentation at all, which is how it went unnoticed
  // that the interstitial never fired and the form had captured 4 profiles in
  // its lifetime (#3448). Without the view event a low completion rate and an
  // unreachable page look identical. `source` separates gate-redirected users
  // from people who navigated to /welcome themselves.
  'welcome_view', 'welcome_save', 'welcome_skip',
  // donate_click / inquiry_click: outbound handoffs to a payment page or an
  // inquiry mailto, emitted by <OutboundLink>. Every giving route on the site
  // ends at a destination we don't own and that sends nothing back, so before
  // these existed "nobody gives through /support/business" and "nobody ever
  // reaches it" were the same observation. Read them as intent, never revenue —
  // the gift lands in EFM's Stripe or NAF's DonorPerfect, not here.
  'donate_click', 'inquiry_click',
]);

// Only these prop keys are persisted; everything else is dropped.
export const ALLOWED_PROPS = new Set([
  'bookId', 'format', 'channel', 'page', 'title', 'url', 'hasDoi', 'edition', 'source', 'reason', 'method',
  // surface: which UI emitted a share (book page / gallery_image /
  // collection_anchor_bar). Share controls exist on several surfaces and until
  // #3399 two of them emitted nothing at all, so an undifferentiated `share`
  // count could not tell "nobody shares" from "that surface isn't wired up".
  'surface',
  // safe: on confirm_view/confirm_click, whether the `next` callback parameter
  // survived transit — separates "changed their mind" from "the link broke".
  'safe',
  // hasName / hasAbout / hasHelp / hasLanguage: on welcome_save, WHICH fields the
  // reader actually filled — never their contents, which live in users.profile. A
  // bare save count cannot tell "they answered everything" from "they typed a name
  // and left the two essay boxes empty", and that distinction is the whole
  // question about whether the form asks for the right things at the right time.
  //
  // ADDING A FIELD TO THE WELCOME FORM MEANS ADDING ITS FLAG HERE. A prop that is
  // not on this list is dropped silently — 200 response, no error, and the key is
  // simply absent when someone queries for it weeks later (CLAUDE.md: "A
  // silently-dropped field is the default failure").
  'hasName', 'hasAbout', 'hasHelp', 'hasLanguage',
  // locale: on donate_click/inquiry_click, which language the surface was serving.
  // /support renders in EN and ES from the same component, so without this every
  // Spanish giving click is filed under the English page and the two are
  // indistinguishable forever. `surface` + `channel` (both above) carry the rest:
  // which page emitted the click, and where it went.
  'locale',
]);
